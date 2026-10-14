/**
 * SSRF matrix I: abuse limits. The relay sends requests from its own network
 * position, so how many it sends — per client, per endpoint, and how many it
 * holds open — is part of what it may send. Each refusal here is observed at
 * the loopback stub: the request that was refused never reached it.
 *
 * The client's address is the socket's (`peerAddress`, injected: there is no
 * socket under `app.request()`), and `X-Forwarded-For` is read only from the
 * one trusted proxy configured.
 */

import type http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { parseNetwork } from "../../src/client-address.js";
import type { RelayConfig } from "../../src/config.js";
import { forward } from "../../src/forward.js";
import { DEFAULT_RATE_LIMITS, type RateLimits } from "../../src/rate-limit.js";
import {
  dialStub,
  never,
  ORIGIN,
  publicEndpoint,
  relayConfig,
  stubServer,
  table,
  type Stub,
} from "./fixtures.js";

const HOST = "testbed.example";
const PEER = "X-Test-Peer";
const PROXY = "172.31.87.1";

let stub: Stub;
beforeAll(async () => {
  stub = await stubServer();
});
afterEach(() => {
  stub.reset();
});
afterAll(async () => {
  await stub.close();
});

const base = (): string => `http://${HOST}:${String(stub.port)}/ogc`;
const dns = table({ [HOST]: ["93.184.215.14"] });

function app(rateLimits: Partial<RateLimits>) {
  const proxy = parseNetwork(PROXY);
  if (proxy === undefined) throw new Error("unreadable proxy");
  const config: RelayConfig = {
    ...relayConfig([publicEndpoint(base())]),
    trustedProxies: [proxy],
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...rateLimits },
  };
  return createApp({
    config,
    schedule: never,
    peerAddress: (c) => c.req.header(PEER),
    forward: (endpoint, request) =>
      forward(endpoint, request, {
        timeoutMs: 5_000,
        maxResponseBytes: 1_024,
        schedule: never,
        lookup: dialStub(dns),
      }),
    onAudit: () => undefined,
  });
}

type App = ReturnType<typeof app>;

async function session(relay: App, peer: string): Promise<string> {
  const response = await relay.request("/sessions", { method: "POST", headers: { [PEER]: peer } });
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("token" in body)) throw new Error("no token");
  const { token } = body;
  if (typeof token !== "string") throw new Error("no token");
  return token;
}

function read(relay: App, peer: string, token: string, path: string, extra = {}) {
  return relay.request(`/read/testbed${path}`, {
    headers: { [PEER]: peer, Origin: ORIGIN, Authorization: `Bearer ${token}`, ...extra },
  });
}

const ok = (_request: http.IncomingMessage, response: http.ServerResponse): void => {
  response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
};

/** Headers at once, then the body held open until `release()`. */
function slowBody(): {
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void;
  release(): void;
} {
  const open: http.ServerResponse[] = [];
  return {
    handler: (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{");
      open.push(response);
    },
    release: () => {
      for (const response of open.splice(0)) response.end("}");
    },
  };
}

describe("I1 — a forged X-Forwarded-For from a peer that is not a trusted proxy", () => {
  it("is ignored: every forged name counts against the socket's address, and the one over sends nothing", async () => {
    stub.on("/ogc/processes", ok);
    const relay = app({ perClient: { ...DEFAULT_RATE_LIMITS.perClient, readsPerMinute: 3 } });
    const token = await session(relay, "198.51.100.7");
    for (let i = 0; i < 3; i += 1) {
      const response = await read(relay, "198.51.100.7", token, "/processes", {
        "X-Forwarded-For": `203.0.113.${String(i)}`,
      });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const connections = stub.connections;
    const refused = await read(relay, "198.51.100.7", token, "/processes", {
      "X-Forwarded-For": "203.0.113.200",
    });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-Relay-Error")).toBe("rate-limited");
    expect(stub.requests).toHaveLength(3);
    expect(stub.connections).toBe(connections);
  });

  it("control: from the trusted proxy, its rightmost entry is the client", async () => {
    stub.on("/ogc/processes", ok);
    const relay = app({ perClient: { ...DEFAULT_RATE_LIMITS.perClient, readsPerMinute: 1 } });
    const token = await session(relay, PROXY);
    const via = (client: string) =>
      read(relay, `::ffff:${PROXY}`, token, "/processes", { "X-Forwarded-For": client });
    expect((await via("203.0.113.1")).status).toBe(200);
    expect((await via("203.0.113.1")).status).toBe(429);
    expect((await via("203.0.113.2")).status).toBe(200);
    expect(stub.requests).toHaveLength(2);
  });
});

describe("I2 — many clients against one endpoint", () => {
  it("stop at the endpoint's ceiling, each well inside its own limit, and the rest reach nothing", async () => {
    stub.on("/ogc/processes", ok);
    const relay = app({ perEndpoint: { requestsPerMinute: 5, inFlight: 32 } });
    const codes: (string | null)[] = [];
    for (let i = 0; i < 8; i += 1) {
      const peer = `198.51.100.${String(i)}`;
      const response = await read(relay, peer, await session(relay, peer), "/processes");
      codes.push(response.headers.get("X-Relay-Error"));
      await response.arrayBuffer();
    }
    expect(codes).toEqual([
      null,
      null,
      null,
      null,
      null,
      "rate-limited-endpoint",
      "rate-limited-endpoint",
      "rate-limited-endpoint",
    ]);
    expect(stub.requests).toHaveLength(5);
  });
});

describe("I3 — slow bodies holding upstream slots", () => {
  it("a client holding its slots with bodies that never end gets no more connections", async () => {
    const slow = slowBody();
    stub.on("/ogc/slow", slow.handler);
    const relay = app({ perClient: { ...DEFAULT_RATE_LIMITS.perClient, inFlight: 2 } });
    const token = await session(relay, "198.51.100.7");
    const held = [
      await read(relay, "198.51.100.7", token, "/slow"),
      await read(relay, "198.51.100.7", token, "/slow"),
    ];
    for (const response of held) expect(response.status).toBe(200);
    const connections = stub.connections;
    const refused = await read(relay, "198.51.100.7", token, "/slow");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-Relay-Error")).toBe("rate-limited");
    expect(stub.connections).toBe(connections);

    slow.release();
    for (const response of held) expect(await response.text()).toBe("{}");
    // The slots come back once each body is done, a few ticks after the text.
    let after = await read(relay, "198.51.100.7", token, "/slow");
    for (let tries = 0; after.status === 429 && tries < 100; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      after = await read(relay, "198.51.100.7", token, "/slow");
    }
    expect(after.status).toBe(200);
    slow.release();
    await after.text();
  });

  it("many clients holding an endpoint's slots stop at its ceiling, without one more connection", async () => {
    const slow = slowBody();
    stub.on("/ogc/slow", slow.handler);
    const relay = app({ perEndpoint: { requestsPerMinute: 600, inFlight: 3 } });
    const held = [];
    for (let i = 0; i < 3; i += 1) {
      const peer = `198.51.100.${String(i)}`;
      held.push(await read(relay, peer, await session(relay, peer), "/slow"));
    }
    const connections = stub.connections;
    const refused = await read(relay, "203.0.113.9", await session(relay, "203.0.113.9"), "/slow");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-Relay-Error")).toBe("rate-limited-endpoint");
    expect(stub.connections).toBe(connections);
    slow.release();
    for (const response of held) await response.text();
  });
});
