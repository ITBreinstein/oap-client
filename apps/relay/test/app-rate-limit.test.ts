/**
 * The rate limits as the routes apply them, in process. Each request names its
 * socket address in a test header, read by an injected `peerAddress`: there is
 * no socket under `app.request()`.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import type { ForwardDone, ForwardedResponse, ForwardRequest } from "../src/forward.js";
import { RateLimiter } from "../src/rate-limit.js";
import { RelayState } from "../src/state.js";
import { mintSecretToken } from "../src/tokens.js";
import type { UpstreamResponse } from "../src/upstream.js";

const ORIGIN = "http://localhost:4173";
const PEER = "X-Test-Peer";

const rawConfig = {
  publicUrl: "https://relay.test",
  allowedOrigins: [ORIGIN],
  trustedProxies: ["172.31.87.1"],
  endpoints: [
    {
      key: "zoo",
      baseUrl: "https://zoo.test/ogc-api",
      executeRoute: "relay",
      readRoute: "relay",
    },
    { key: "with-callbacks", baseUrl: "https://ogc.test", executeRoute: "relay", callbacks: true },
  ],
};

const CREATED: UpstreamResponse = {
  status: 201,
  location: "https://ogc.test/jobs/abc",
  contentType: "application/json",
  preferenceApplied: "respond-async",
  body: "{}",
};

/** A forwarded answer whose body the test ends, or breaks off, by hand. */
interface Pending {
  readonly response: ForwardedResponse;
  finish(): void;
  breakOff(): void;
}

function pending(): Pending {
  let settle: (done: ForwardDone) => void = () => undefined;
  const done = new Promise<ForwardDone>((resolve) => {
    settle = resolve;
  });
  return {
    response: {
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      body: null,
      finalUrl: "https://zoo.test/ogc-api/",
      redirectsFollowed: 0,
      done,
    },
    finish: () => {
      settle({ bytes: 2, capHit: undefined });
    },
    breakOff: () => {
      settle({ bytes: 1, capHit: undefined, connectionFailed: true });
    },
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const config = parseConfig({ ...rawConfig, ...overrides });
  let now = 1_000_000;
  const clock = {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  const state = new RelayState(clock, {
    registrationTtlMs: 60_000,
    sessionIdleTtlMs: 60_000,
    maxSessions: 1_000,
    maxRegistrationsPerSession: 100,
  });
  const limiter = new RateLimiter(clock, config.rateLimits);
  const forwarded: ForwardRequest[] = [];
  const executed: string[] = [];
  let reply: () => Promise<ForwardedResponse> = () => Promise.resolve(pending().response);
  const app = createApp({
    config,
    state,
    clock,
    rateLimiter: limiter,
    schedule: () => () => undefined,
    onAudit: () => undefined,
    peerAddress: (c) => c.req.header(PEER),
    forward: (_endpoint, request) => {
      forwarded.push(request);
      return reply();
    },
    upstream: (endpoint, processId) => {
      executed.push(`${endpoint.key}/${processId}`);
      return Promise.resolve(CREATED);
    },
  });
  return {
    app,
    clock,
    state,
    limiter,
    forwarded,
    executed,
    replyWith(next: () => Promise<ForwardedResponse>) {
      reply = next;
    },
  };
}

type Harness = ReturnType<typeof harness>;

const from = (peer: string, headers: Record<string, string> = {}) => ({ [PEER]: peer, ...headers });

async function session(h: Harness, peer: string): Promise<string> {
  const response = await h.app.request("/sessions", { method: "POST", headers: from(peer) });
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("token" in body)) throw new Error("no token");
  const { token } = body;
  if (typeof token !== "string") throw new Error("no token");
  return token;
}

const read = (h: Harness, peer: string, token: string, path = "/read/zoo/processes") =>
  h.app.request(path, { headers: from(peer, { Authorization: `Bearer ${token}` }) });

const execute = (h: Harness, peer: string, path = "/execute/with-callbacks/echo") =>
  h.app.request(path, {
    method: "POST",
    headers: from(peer, { "Content-Type": "application/json", Prefer: "respond-async" }),
    body: "{}",
  });

describe("the 429", () => {
  it("is the relay's own refusal, with Retry-After, and says nothing about the client", async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) await session(h, "198.51.100.7");
    const response = await h.app.request("/sessions", {
      method: "POST",
      headers: from("198.51.100.7", { Origin: ORIGIN }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("6");
    expect(response.headers.get("X-Relay-Error")).toBe("rate-limited");
    expect(response.headers.get("X-Relay")).toBe("1");
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      type: "about:blank",
      title: "Too Many Requests",
      status: 429,
      detail: "too many requests from this client; try again later",
    });
    expect(text).not.toContain("198.51.100");
  });

  it("can be read cross-origin: Retry-After and the code are exposed on /sessions", async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) await session(h, "198.51.100.7");
    const response = await h.app.request("/sessions", {
      method: "POST",
      headers: from("198.51.100.7", { Origin: ORIGIN }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const exposed = (response.headers.get("Access-Control-Expose-Headers") ?? "").split(",");
    expect(exposed).toEqual(expect.arrayContaining(["Retry-After", "X-Relay-Error"]));
  });

  it("names the per-endpoint ceiling apart from a client's own limit", async () => {
    const h = harness({ rateLimits: { perEndpoint: { requestsPerMinute: 1 } } });
    expect((await execute(h, "198.51.100.1")).status).toBe(200);
    const response = await execute(h, "198.51.100.2");
    expect(response.status).toBe(429);
    expect(response.headers.get("X-Relay-Error")).toBe("rate-limited-endpoint");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({
      detail: "too many requests to this endpoint through the relay; try again later",
    });
  });
});

describe("what is limited", () => {
  it("counts CORS preflights, and answers the one over with a 429", async () => {
    const h = harness();
    const preflight = () =>
      h.app.request("/read/zoo/processes", {
        method: "OPTIONS",
        headers: from("198.51.100.7", {
          Origin: ORIGIN,
          "Access-Control-Request-Method": "GET",
        }),
      });
    for (let i = 0; i < 120; i += 1) expect((await preflight()).status).toBe(204);
    expect((await preflight()).status).toBe(429);
    const listing = await h.app.request("/endpoints", { headers: from("198.51.100.7") });
    expect(listing.status).toBe(429); // the same budget as GET /endpoints
  });

  it("refuses the 21st execute in a minute without sending it, or registering a callback", async () => {
    const h = harness();
    const token = await session(h, "198.51.100.7");
    const auth = { Authorization: `Bearer ${token}` };
    for (let i = 0; i < 20; i += 1) {
      const ok = await h.app.request("/execute/with-callbacks/echo", {
        method: "POST",
        headers: from("198.51.100.7", { "Content-Type": "application/json", ...auth }),
        body: "{}",
      });
      expect(ok.status).toBe(200);
    }
    const registrations = h.state.counts().registrations;
    const refused = await h.app.request("/execute/with-callbacks/echo", {
      method: "POST",
      headers: from("198.51.100.7", { "Content-Type": "application/json", ...auth }),
      body: "{}",
    });
    expect(refused.status).toBe(429);
    expect(h.executed).toHaveLength(20);
    expect(h.state.counts().registrations).toBe(registrations);
  });

  it("refuses the 11th session in a minute, and creates no session for it", async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) await session(h, "198.51.100.7");
    const refused = await h.app.request("/sessions", {
      method: "POST",
      headers: from("198.51.100.7"),
    });
    expect(refused.status).toBe(429);
    expect(h.state.counts().sessions).toBe(10);
  });

  it("counts a read refused for its session too, so a client cannot probe for free", async () => {
    const h = harness({ rateLimits: { perClient: { readsPerMinute: 2 } } });
    const bogus = mintSecretToken();
    expect((await read(h, "198.51.100.7", bogus)).status).toBe(401);
    expect((await read(h, "198.51.100.7", bogus)).status).toBe(401);
    expect((await read(h, "198.51.100.7", bogus)).status).toBe(429);
  });

  it("never limits /healthz or the callbacks", async () => {
    const h = harness({
      rateLimits: {
        perClient: { endpointsAndPreflightsPerMinute: 1, executesPerMinute: 1 },
        perEndpoint: { requestsPerMinute: 1 },
      },
    });
    for (let i = 0; i < 50; i += 1) {
      expect((await h.app.request("/healthz", { headers: from("198.51.100.7") })).status).toBe(200);
      const callback = await h.app.request(`/callbacks/${mintSecretToken()}/success`, {
        method: "POST",
        headers: from("198.51.100.7"),
      });
      expect(callback.status).toBe(404); // an unknown token, answered as always
    }
    expect(h.limiter.report()).toBeUndefined();
  });
});

describe("who the client is", () => {
  it("ignores X-Forwarded-For from a peer that is not a trusted proxy", async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) {
      await h.app.request("/sessions", {
        method: "POST",
        headers: from("198.51.100.7", { "X-Forwarded-For": `203.0.113.${String(i)}` }),
      });
    }
    const refused = await h.app.request("/sessions", {
      method: "POST",
      headers: from("198.51.100.7", { "X-Forwarded-For": "203.0.113.200" }),
    });
    expect(refused.status).toBe(429);
  });

  it("behind the trusted proxy, keys each client by the address the proxy wrote", async () => {
    const h = harness();
    const viaProxy = (client: string) =>
      h.app.request("/sessions", {
        method: "POST",
        headers: from("::ffff:172.31.87.1", { "X-Forwarded-For": client }),
      });
    for (let i = 0; i < 10; i += 1) expect((await viaProxy("203.0.113.1")).status).toBe(201);
    expect((await viaProxy("203.0.113.1")).status).toBe(429);
    expect((await viaProxy("203.0.113.2")).status).toBe(201);
    // A client's own entry, to the left of the proxy's, changes nothing.
    expect((await viaProxy("203.0.113.99, 203.0.113.1")).status).toBe(429);
  });

  it("puts a trusted proxy's requests with no client named in one shared bucket", async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) {
      const response = await h.app.request("/sessions", {
        method: "POST",
        headers: from("172.31.87.1"),
      });
      expect(response.status).toBe(201);
    }
    const refused = await h.app.request("/sessions", {
      method: "POST",
      headers: from("172.31.87.1", { "X-Forwarded-For": "garbage" }),
    });
    expect(refused.status).toBe(429);
    expect(h.limiter.report()).toMatchObject({ unknownBucket: 11, rateLimit: { sessions: 1 } });
  });
});

describe("upstream slots", () => {
  it("holds a read's slot until its body is done, and gives it back then", async () => {
    const h = harness({ rateLimits: { perClient: { inFlight: 1 } } });
    const token = await session(h, "198.51.100.7");
    const first = pending();
    h.replyWith(() => Promise.resolve(first.response));
    expect((await read(h, "198.51.100.7", token)).status).toBe(200);
    // Headers are back, the body is not: the slot is still held.
    const second = await read(h, "198.51.100.7", token);
    expect(second.status).toBe(429);
    expect(second.headers.get("X-Relay-Error")).toBe("rate-limited");
    expect(h.forwarded).toHaveLength(1);
    first.finish();
    await first.response.done;
    await Promise.resolve();
    h.replyWith(() => Promise.resolve(pending().response));
    expect((await read(h, "198.51.100.7", token)).status).toBe(200);
  });

  it("gives the slot back when the body is broken off", async () => {
    const h = harness({ rateLimits: { perClient: { inFlight: 1 } } });
    const token = await session(h, "198.51.100.7");
    const first = pending();
    h.replyWith(() => Promise.resolve(first.response));
    await read(h, "198.51.100.7", token);
    first.breakOff();
    await first.response.done;
    await Promise.resolve();
    h.replyWith(() => Promise.resolve(pending().response));
    expect((await read(h, "198.51.100.7", token)).status).toBe(200);
  });

  it("gives the slot back when the exchange fails before an answer", async () => {
    const h = harness({ rateLimits: { perClient: { inFlight: 1 } } });
    const token = await session(h, "198.51.100.7");
    h.replyWith(() => Promise.reject(new Error("refused")));
    expect((await read(h, "198.51.100.7", token)).status).toBe(502);
    h.replyWith(() => Promise.resolve(pending().response));
    expect((await read(h, "198.51.100.7", token)).status).toBe(200);
  });

  it("holds the per-endpoint ceiling across many clients, each well inside its own", async () => {
    const h = harness({ rateLimits: { perEndpoint: { requestsPerMinute: 30 } } });
    let refusedWith: string | null = null;
    let sent = 0;
    for (let i = 0; i < 40; i += 1) {
      const response = await execute(h, `198.51.100.${String(i)}`);
      if (response.status === 200) sent += 1;
      else refusedWith = response.headers.get("X-Relay-Error");
    }
    expect(sent).toBe(30);
    expect(h.executed).toHaveLength(30);
    expect(refusedWith).toBe("rate-limited-endpoint");
  });
});

describe("event streams", () => {
  it("refuses a client's fifth open stream, and allows one again once one closes", async () => {
    const h = harness();
    const open = async (peer: string) => {
      const token = await session(h, peer);
      return h.app.request("/sessions/events", {
        headers: from(peer, { Authorization: `Bearer ${token}` }),
      });
    };
    const streams = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await open("198.51.100.7");
      expect(response.status).toBe(200);
      streams.push(response);
    }
    const refused = await open("198.51.100.7");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-Relay-Error")).toBe("rate-limited");
    expect((await open("198.51.100.8")).status).toBe(200);
    await streams[0]?.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await open("198.51.100.7")).status).toBe(200);
    for (const stream of streams.slice(1)) await stream.body?.cancel();
  });

  it("gives the slot back when the stream is refused for its session", async () => {
    const h = harness({ rateLimits: { perClient: { openStreams: 1 } } });
    const bogus = await h.app.request("/sessions/events", {
      headers: from("198.51.100.7", { Authorization: `Bearer ${mintSecretToken()}` }),
    });
    expect(bogus.status).toBe(401);
    const token = await session(h, "198.51.100.7");
    const ok = await h.app.request("/sessions/events", {
      headers: from("198.51.100.7", { Authorization: `Bearer ${token}` }),
    });
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });
});
