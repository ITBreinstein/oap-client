/**
 * The listener settings `server.ts` applies: how long a silent socket may
 * live (review R4), and how the relay stops with event streams open (R5).
 */

import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { DEFAULT_LIMITS } from "../src/config.js";
import { socketTimeoutMs, stopListening } from "../src/listener.js";
import { publicEndpoint, relayConfig } from "./ssrf/fixtures.js";

describe("socketTimeoutMs", () => {
  it("outlasts both upstream deadlines by default", () => {
    const ms = socketTimeoutMs(DEFAULT_LIMITS);
    expect(ms).toBeGreaterThan(DEFAULT_LIMITS.readTimeoutMs);
    expect(ms).toBeGreaterThan(DEFAULT_LIMITS.upstreamTimeoutMs);
  });

  it("follows whichever deadline is longer", () => {
    expect(socketTimeoutMs({ readTimeoutMs: 1_000, upstreamTimeoutMs: 200_000 })).toBeGreaterThan(
      200_000,
    );
    expect(socketTimeoutMs({ readTimeoutMs: 200_000, upstreamTimeoutMs: 1_000 })).toBeGreaterThan(
      200_000,
    );
  });

  it("stays within what a Node timer can hold", () => {
    expect(socketTimeoutMs({ readTimeoutMs: 30 * 24 * 3_600_000, upstreamTimeoutMs: 1_000 })).toBe(
      2_147_483_647,
    );
  });
});

let upstream: http.Server;
let upstreamBase = "";

beforeAll(async () => {
  upstream = http.createServer((_request, response) => {
    setTimeout(
      () => response.writeHead(200, { "Content-Type": "text/plain" }).end("late answer"),
      600,
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  upstreamBase = `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}/ogc`;
});

afterAll(async () => {
  upstream.closeAllConnections();
  upstream.close();
  await once(upstream, "close").catch(() => undefined);
});

async function listen(readTimeoutMs = DEFAULT_LIMITS.readTimeoutMs): Promise<{
  server: ServerType;
  base: string;
}> {
  const config = relayConfig([publicEndpoint(upstreamBase, { allowPrivateNetwork: true })], {
    readTimeoutMs,
  });
  const server = serve({
    fetch: createApp({ config, onAudit: () => undefined }).fetch,
    port: 0,
    hostname: "127.0.0.1",
  });
  await once(server, "listening");
  server.setTimeout(socketTimeoutMs(config.limits));
  return { server, base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}` };
}

async function sessionToken(base: string): Promise<string> {
  const session = (await (await fetch(`${base}/sessions`, { method: "POST" })).json()) as {
    token: string;
  };
  return session.token;
}

describe("a silent socket, through the real listener", () => {
  it("is not cut while the upstream is still within the read deadline", async () => {
    // At the old ratio (socket 60 s : read 120 s) a 600 ms answer under a
    // 1 200 ms deadline would have been cut at 600 ms.
    const { server, base } = await listen(1_200);
    try {
      const response = await fetch(`${base}/read/testbed/slow`, {
        headers: { Authorization: `Bearer ${await sessionToken(base)}` },
      });
      expect(`${String(response.status)} ${await response.text()}`).toBe("200 late answer");
    } finally {
      server.close();
      await once(server, "close").catch(() => undefined);
    }
  });
});

describe("stopListening", () => {
  it("stops the listener while a browser has its doorbell stream open", async () => {
    const { server, base } = await listen();
    const stream = await fetch(`${base}/sessions/events`, {
      headers: { Authorization: `Bearer ${await sessionToken(base)}` },
    });
    if (stream.body === null) throw new Error("no stream");
    const reader = stream.body.getReader();
    await reader.read(); // `ready`

    const exit = vi.fn();
    const closed = once(server, "close").then(() => "closed");
    stopListening(server, exit);
    const outcome = await Promise.race([
      closed,
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("still listening after 2 s");
        }, 2_000);
      }),
    ]);
    expect(outcome).toBe("closed");
    await expect(reader.read()).rejects.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });

  it("forces an exit if something still holds the process after the grace period", async () => {
    const { server } = await listen();
    const exit = vi.fn();
    stopListening(server, exit, 20);
    await once(server, "close");
    await vi.waitFor(
      () => {
        expect(exit).toHaveBeenCalledTimes(1);
      },
      { timeout: 1_000 },
    );
  });
});
