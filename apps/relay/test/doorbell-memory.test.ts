/**
 * The doorbell stream's memory, measured: every wait in its loop used to race
 * a new promise against one that stays pending for the stream's whole life.
 * V8 keeps each such reaction until that promise settles, so an open stream
 * grew by about 300 B per doorbell and per heartbeat, without bound (review
 * R2). The callback token that rings a doorbell is effectively public
 * (finding 0047), so anyone holding one could grow the relay's heap.
 *
 * Measured after GC, over 40 000 rounds: about 3 B per round with the fix,
 * about 315 B without it. The bar is 16 B.
 */
import v8 from "node:v8";
import vm from "node:vm";
import { expect, it } from "vitest";
import { createApp, type UpstreamCall } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { RelayState } from "../src/state.js";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

function heap(): number {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

const config = parseConfig({
  publicUrl: "http://relay.test:8787",
  endpoints: [{ key: "cb", baseUrl: "https://ogc.test", executeRoute: "relay", callbacks: true }],
});

function setup() {
  let now = 1_000_000;
  const clock = { now: () => now };
  const state = new RelayState(clock, {
    registrationTtlMs: config.registrationTtlMs,
    sessionIdleTtlMs: config.sessionIdleTtlMs,
    maxSessions: 10,
    maxRegistrationsPerSession: 10,
  });
  let sentBody = "";
  const upstream: UpstreamCall = (_e, _p, body) => {
    sentBody = body;
    return Promise.resolve({
      status: 201,
      location: "https://ogc.test/jobs/1",
      contentType: "application/json",
      preferenceApplied: "respond-async",
      body: "null",
    });
  };
  const heartbeats = new Set<() => void>();
  const app = createApp({
    config,
    state,
    clock,
    upstream,
    schedule: (callback) => {
      heartbeats.add(callback);
      return () => heartbeats.delete(callback);
    },
    onEvent: () => undefined,
  });
  return {
    app,
    state,
    callbackToken: () => /\/callbacks\/([^/]+)\/success/.exec(sentBody)?.[1] ?? "",
    fireHeartbeat: () => {
      for (const callback of [...heartbeats]) {
        heartbeats.delete(callback);
        callback();
      }
    },
    tick: () => (now += 1),
  };
}

async function openStream(app: ReturnType<typeof createApp>, token: string) {
  const response = await app.request("/sessions/events", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.body === null) throw new Error("no stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    /** Resolves once `count` more occurrences of `marker` have been read. */
    async await(marker: string, count = 1): Promise<void> {
      let seen = 0;
      for (;;) {
        let index = buffer.indexOf(marker);
        while (index !== -1) {
          seen += 1;
          buffer = buffer.slice(index + marker.length);
          if (seen === count) return;
          index = buffer.indexOf(marker);
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("stream ended");
        const bytes: unknown = chunk.value;
        if (!(bytes instanceof Uint8Array)) throw new Error("non-byte chunk");
        buffer += decoder.decode(bytes, { stream: true });
      }
    },
    close: () => reader.cancel(),
  };
}

const ROUNDS = 40_000;

/** A callback or a heartbeat arrives in its own I/O turn, never in the same microtask run. */
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

it(`retains no memory over ${String(ROUNDS)} doorbells rung on one open stream`, async () => {
  const h = setup();
  const session = (await (await h.app.request("/sessions", { method: "POST" })).json()) as {
    token: string;
  };
  const stream = await openStream(h.app, session.token);
  await stream.await("event: ready");
  await h.app.request("/execute/cb/p", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: "{}",
  });
  const callback = `/callbacks/${h.callbackToken()}/success`;

  // Warm up, so that one-off allocations are not counted.
  for (let i = 0; i < 1_000; i++) {
    await nextTurn();
    await h.app.request(callback, { method: "POST" });
    await stream.await("event: job");
  }
  const before = heap();
  for (let i = 0; i < ROUNDS; i++) {
    await nextTurn();
    await h.app.request(callback, { method: "POST" });
    await stream.await("event: job");
  }
  const after = heap();
  await stream.close();
  await expect.poll(() => h.state.counts().listeners, { interval: 0 }).toBe(0);

  const retainedPerRing = (after - before) / ROUNDS;
  expect(retainedPerRing).toBeLessThan(16);
}, 60_000);

it(`retains no memory over ${String(ROUNDS)} heartbeats on one idle stream`, async () => {
  const h = setup();
  const session = (await (await h.app.request("/sessions", { method: "POST" })).json()) as {
    token: string;
  };
  const stream = await openStream(h.app, session.token);
  await stream.await("event: ready");
  for (let i = 0; i < 1_000; i++) {
    await nextTurn();
    h.fireHeartbeat();
    await stream.await(": keepalive");
  }
  const before = heap();
  for (let i = 0; i < ROUNDS; i++) {
    await nextTurn();
    h.fireHeartbeat();
    await stream.await(": keepalive");
  }
  const after = heap();
  await stream.close();
  const retainedPerBeat = (after - before) / ROUNDS;
  expect(retainedPerBeat).toBeLessThan(16);
}, 60_000);
