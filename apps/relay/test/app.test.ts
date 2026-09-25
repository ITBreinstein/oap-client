/**
 * The relay's routes, end to end in process: no listener, no network, no
 * sleeps. Time is a hand-stepped clock and the upstream OGC server is a
 * function, so every branch here is deterministic.
 */

import { describe, expect, it } from "vitest";
import { createApp, type RelayEvent, type UpstreamCall } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { RelayState, type Clock } from "../src/state.js";
import { mintSecretToken } from "../src/tokens.js";
import { UpstreamError, type UpstreamResponse } from "../src/upstream.js";

const ORIGIN = "http://localhost:4173";
const PUBLIC = "http://relay.test:8787";

const config = parseConfig({
  publicUrl: PUBLIC,
  allowedOrigins: [ORIGIN],
  endpoints: [
    { key: "with-callbacks", baseUrl: "http://ogc.test", executeRoute: "relay", callbacks: true },
    { key: "no-callbacks", baseUrl: "http://ogc.test", executeRoute: "relay" },
    { key: "direct", baseUrl: "http://ogc.test", executeRoute: "direct" },
  ],
  limits: { maxExecuteBodyBytes: 4_096 },
  registrationTtlMs: 60_000,
  sessionIdleTtlMs: 60_000,
});

const CREATED: UpstreamResponse = {
  status: 201,
  location: "http://ogc.test/jobs/abc",
  contentType: "application/json",
  preferenceApplied: "respond-async",
  body: "null",
};

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly state: RelayState;
  readonly clock: Clock & { advance(ms: number): void };
  readonly sent: { endpointKey: string; processId: string; body: unknown }[];
  readonly events: RelayEvent[];
}

function harness(upstream?: UpstreamCall): Harness {
  let now = 1_000_000;
  const clock = {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  const state = new RelayState(clock, {
    registrationTtlMs: config.registrationTtlMs,
    sessionIdleTtlMs: config.sessionIdleTtlMs,
    maxSessions: 10,
    maxRegistrationsPerSession: 10,
  });
  const sent: Harness["sent"] = [];
  const events: RelayEvent[] = [];
  const app = createApp({
    config,
    state,
    clock,
    // The heartbeat never fires here; the scheduler hands back a no-op.
    schedule: () => () => undefined,
    onEvent: (event) => events.push(event),
    upstream:
      upstream ??
      ((endpoint, processId, body) => {
        sent.push({ endpointKey: endpoint.key, processId, body: JSON.parse(body) });
        return Promise.resolve(CREATED);
      }),
  });
  return { app, state, clock, sent, events };
}

async function newSession(app: Harness["app"]): Promise<string> {
  const response = await app.request("/sessions", { method: "POST" });
  expect(response.status).toBe(201);
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string"
  ) {
    throw new Error("no session token");
  }
  return body.token;
}

function execute(
  app: Harness["app"],
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    }),
  );
}

/** The callback token the relay put into the subscriber URLs it sent upstream. */
function callbackTokenSent(harnessState: Harness): string {
  const body = harnessState.sent.at(-1)?.body;
  if (typeof body !== "object" || body === null || !("subscriber" in body)) {
    throw new Error("no subscriber was sent");
  }
  const subscriber = body.subscriber;
  if (typeof subscriber !== "object" || subscriber === null || !("successUri" in subscriber)) {
    throw new Error("no successUri");
  }
  const uri = subscriber.successUri;
  if (typeof uri !== "string") throw new Error("successUri is not a string");
  const match = /\/callbacks\/([^/]+)\/success$/.exec(uri);
  if (match?.[1] === undefined) throw new Error("unexpected successUri shape");
  return match[1];
}

async function refFrom(response: Response): Promise<string | null> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("registration" in body)) {
    throw new Error("no registration member");
  }
  const registration = body.registration;
  if (registration === null) return null;
  if (
    typeof registration !== "object" ||
    !("ref" in registration) ||
    typeof registration.ref !== "string"
  ) {
    throw new Error("malformed registration");
  }
  return registration.ref;
}

/** Reads server-sent events one block at a time. Comment-only blocks are skipped. */
function sseReader(response: Response) {
  const body = response.body;
  if (body === null) throw new Error("no stream");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(): Promise<{ event: string; data: string }> {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const fields = block.split("\n").filter((line) => !line.startsWith(":"));
          if (fields.length === 0) continue;
          const event = fields.find((line) => line.startsWith("event: "))?.slice(7) ?? "message";
          const data = fields.find((line) => line.startsWith("data: "))?.slice(6) ?? "";
          return { event, data };
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("stream ended");
        const bytes: unknown = chunk.value;
        if (!(bytes instanceof Uint8Array)) throw new Error("stream sent a non-byte chunk");
        buffer += decoder.decode(bytes, { stream: true });
      }
    },
    close: () => reader.cancel(),
  };
}

async function openEvents(app: Harness["app"], token: string) {
  const response = await app.request("/sessions/events", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const events = sseReader(response);
  expect(await events.next()).toEqual({ event: "ready", data: "{}" });
  return events;
}

it("answers the health check", async () => {
  const res = await createApp().request("/healthz");
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ ok: true });
});

describe("GET /endpoints", () => {
  it("lists each endpoint's route and callback setting, and nothing about its network", async () => {
    const { app } = harness();
    const body: unknown = await (await app.request("/endpoints")).json();
    expect(body).toEqual({
      endpoints: [
        {
          key: "with-callbacks",
          baseUrl: "http://ogc.test",
          executeRoute: "relay",
          readRoute: "direct",
          callbacks: true,
        },
        {
          key: "no-callbacks",
          baseUrl: "http://ogc.test",
          executeRoute: "relay",
          readRoute: "direct",
          callbacks: false,
        },
        {
          key: "direct",
          baseUrl: "http://ogc.test",
          executeRoute: "direct",
          readRoute: "direct",
          callbacks: false,
        },
      ],
    });
  });
});

describe("CORS", () => {
  it("allows exactly the configured origin, without credentials", async () => {
    const { app } = harness();
    const preflight = await app.request("/execute/with-callbacks/slow", {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("grants nothing to any other origin", async () => {
    const { app } = harness();
    const response = await app.request("/endpoints", {
      headers: { Origin: "https://evil.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("puts no CORS headers on the server-to-server callback route", async () => {
    const { app } = harness();
    const response = await app.request(`/callbacks/${mintSecretToken()}/success`, {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST /execute — refusals before anything is sent", () => {
  it.each([
    ["an unknown endpoint", "/execute/nope/slow", "{}", {}, 404],
    ["a direct-route endpoint", "/execute/direct/slow", "{}", {}, 409],
    ["a process id that could reshape the URL", "/execute/no-callbacks/..%2Fjobs", "{}", {}, 400],
    ["a body that is not JSON", "/execute/no-callbacks/slow", "{", {}, 400],
    ["a body that is not an object", "/execute/no-callbacks/slow", "[1]", {}, 400],
    [
      "a browser-supplied subscriber",
      "/execute/no-callbacks/slow",
      '{"subscriber":{"successUri":"http://x"}}',
      {},
      400,
    ],
    [
      "an unknown session",
      "/execute/with-callbacks/slow",
      "{}",
      { Authorization: `Bearer ${mintSecretToken()}` },
      401,
    ],
    [
      "a malformed session",
      "/execute/with-callbacks/slow",
      "{}",
      { Authorization: "Bearer x" },
      401,
    ],
    [
      "a body over the limit",
      "/execute/no-callbacks/slow",
      JSON.stringify({ x: "y".repeat(5_000) }),
      {},
      413,
    ],
  ])("refuses %s", async (_, path, body, headers, status) => {
    const h = harness();
    const response = await execute(h.app, path, body, headers);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toMatch(/^application\/problem\+json/);
    expect(h.sent).toEqual([]);
  });

  it("refuses a non-JSON media type", async () => {
    const h = harness();
    const response = await h.app.request("/execute/no-callbacks/slow", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    expect(response.status).toBe(415);
    expect(h.sent).toEqual([]);
  });

  it("never echoes the request back in a refusal", async () => {
    const { app } = harness();
    const marker = "<script>marker-9f3a</script>";
    const response = await execute(
      app,
      "/execute/no-callbacks/slow",
      JSON.stringify({ subscriber: marker }),
    );
    expect(await response.text()).not.toContain("marker-9f3a");
  });
});

describe("POST /execute — relayed", () => {
  it("hands back Location, which is the whole point (finding 0039)", async () => {
    const h = harness();
    const response = await execute(h.app, "/execute/no-callbacks/slow", '{"inputs":{"seconds":1}}');
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({ upstream: CREATED, registration: null });
    expect(h.sent).toEqual([
      { endpointKey: "no-callbacks", processId: "slow", body: { inputs: { seconds: 1 } } },
    ]);
  });

  it("with a session and callbacks on, mints a registration and sends its subscriber URLs", async () => {
    const h = harness();
    const token = await newSession(h.app);
    const response = await execute(h.app, "/execute/with-callbacks/slow", '{"inputs":{}}', {
      Authorization: `Bearer ${token}`,
    });

    const ref = await refFrom(response);
    expect(ref).toEqual(expect.any(String));
    const callbackToken = callbackTokenSent(h);
    expect(callbackToken).not.toBe(token);
    expect(h.sent[0]?.body).toEqual({
      inputs: {},
      subscriber: {
        successUri: `${PUBLIC}/callbacks/${callbackToken}/success`,
        inProgressUri: `${PUBLIC}/callbacks/${callbackToken}/in-progress`,
        failedUri: `${PUBLIC}/callbacks/${callbackToken}/failed`,
      },
    });
  });

  it("without a session, sends no subscriber — the job is polled like any other", async () => {
    const h = harness();
    const response = await execute(h.app, "/execute/with-callbacks/slow", "{}");
    expect(await refFrom(response)).toBeNull();
    expect(h.sent[0]?.body).toEqual({});
  });

  it("with callbacks off, sends no subscriber even with a session", async () => {
    const h = harness();
    const token = await newSession(h.app);
    const response = await execute(h.app, "/execute/no-callbacks/slow", "{}", {
      Authorization: `Bearer ${token}`,
    });
    expect(await refFrom(response)).toBeNull();
    expect(h.sent[0]?.body).toEqual({});
  });

  it("passes an upstream refusal through, and drops the registration it made", async () => {
    const h = harness(() =>
      Promise.resolve({ ...CREATED, status: 400, location: undefined, body: '{"title":"bad"}' }),
    );
    const token = await newSession(h.app);
    const response = await execute(h.app, "/execute/with-callbacks/slow", "{}", {
      Authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(200);
    expect(await refFrom(response)).toBeNull();
    expect(h.state.counts().registrations).toBe(0);
  });

  it("answers 502 with a reason code when the exchange fails, and drops the registration", async () => {
    const h = harness(() => Promise.reject(new UpstreamError("blocked-address")));
    const token = await newSession(h.app);
    const response = await execute(h.app, "/execute/with-callbacks/slow", "{}", {
      Authorization: `Bearer ${token}`,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Bad Gateway",
      status: 502,
      reason: "blocked-address",
    });
    expect(h.state.counts().registrations).toBe(0);
  });
});

describe("POST /callbacks", () => {
  async function registered() {
    const h = harness();
    const token = await newSession(h.app);
    const events = await openEvents(h.app, token);
    const ref = await refFrom(
      await execute(h.app, "/execute/with-callbacks/slow", "{}", {
        Authorization: `Bearer ${token}`,
      }),
    );
    return { ...h, token, events, ref, callbackToken: callbackTokenSent(h) };
  }

  it("rings the session's stream with the ref — a doorbell, not job data", async () => {
    const { app, events, ref, callbackToken } = await registered();
    const response = await app.request(`/callbacks/${callbackToken}/in-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"status":"successful","jobID":"someone-elses-job"}',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    // The body claimed a status and a job id. Neither reaches the browser.
    expect(await events.next()).toEqual({ event: "job", data: JSON.stringify({ ref }) });
    await events.close();
  });

  it("accepts a duplicate callback, and rings again", async () => {
    const { app, events, ref, callbackToken } = await registered();
    for (let i = 0; i < 2; i += 1) {
      const response = await app.request(`/callbacks/${callbackToken}/success`, { method: "POST" });
      expect(response.status).toBe(200);
      expect(await events.next()).toEqual({ event: "job", data: JSON.stringify({ ref }) });
    }
    await events.close();
  });

  it("answers an unknown token 404 — never a refused connection (finding 0047)", async () => {
    const { app, events } = harness();
    const response = await app.request(`/callbacks/${mintSecretToken()}/success`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
    expect(events).toContainEqual({
      kind: "callback",
      callbackKind: "success",
      outcome: "unknown",
    });
  });

  it("answers an expired token 404", async () => {
    const { app, clock, callbackToken, events } = await registered();
    clock.advance(60_000);
    const response = await app.request(`/callbacks/${callbackToken}/success`, { method: "POST" });
    expect(response.status).toBe(404);
    await events.close();
  });

  it("answers a malformed token or an unknown kind 404, without looking anything up", async () => {
    const { app, callbackToken, events } = await registered();
    expect((await app.request("/callbacks/short/success", { method: "POST" })).status).toBe(404);
    expect(
      (await app.request(`/callbacks/${callbackToken}/dismissed`, { method: "POST" })).status,
    ).toBe(404);
    await events.close();
  });

  it("answers an oversized callback promptly without reading its body", async () => {
    const { app, events, ref, callbackToken } = await registered();
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1_000) controller.close();
        else controller.enqueue(chunk);
      },
    });

    const response = await app.request(
      new Request(`http://relay.test/callbacks/${callbackToken}/success`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(1_000 * chunk.byteLength),
        },
        body,
        duplex: "half",
      }),
    );

    expect(response.status).toBe(200);
    expect(await events.next()).toEqual({ event: "job", data: JSON.stringify({ ref }) });
    // At most the stream's own read-ahead; nowhere near the 64 MB offered.
    expect(pulled).toBeLessThan(3);
    await events.close();
  });
});

describe("GET /sessions/events", () => {
  it("refuses an unknown or malformed session, so the browser opens a new one", async () => {
    const { app } = harness();
    for (const header of [`Bearer ${mintSecretToken()}`, "Bearer short", "Basic abc", undefined]) {
      const response = await app.request("/sessions/events", {
        headers: header === undefined ? {} : { Authorization: header },
      });
      expect(response.status).toBe(401);
    }
  });

  it("coalesces a burst of doorbells for one job into one event", async () => {
    const h = harness();
    const token = await newSession(h.app);
    const events = await openEvents(h.app, token);
    const auth = { Authorization: `Bearer ${token}` };
    const refA = await refFrom(await execute(h.app, "/execute/with-callbacks/a", "{}", auth));
    const tokenA = callbackTokenSent(h);
    const refB = await refFrom(await execute(h.app, "/execute/with-callbacks/b", "{}", auth));
    const tokenB = callbackTokenSent(h);

    // ZOO's once-a-second in-progress calls (finding 0048), compressed: five
    // rings for A in one tick, then one for B as a sentinel.
    for (let i = 0; i < 5; i += 1) h.state.ring(tokenA);
    h.state.ring(tokenB);

    expect(await events.next()).toEqual({ event: "job", data: JSON.stringify({ ref: refA }) });
    expect(await events.next()).toEqual({ event: "job", data: JSON.stringify({ ref: refB }) });
    await events.close();
  });

  it("stops listening when the stream closes", async () => {
    const h = harness();
    const token = await newSession(h.app);
    const events = await openEvents(h.app, token);
    expect(h.state.counts().listeners).toBe(1);
    await events.close();
    await expect.poll(() => h.state.counts().listeners, { interval: 0 }).toBe(0);
    expect(h.events).toContainEqual({ kind: "stream", change: "closed" });
  });
});

describe("a relay restart", () => {
  it("forgets everything, and still answers — old callbacks 404, old sessions 401", async () => {
    const before = harness();
    const token = await newSession(before.app);
    await execute(before.app, "/execute/with-callbacks/slow", "{}", {
      Authorization: `Bearer ${token}`,
    });
    const callbackToken = callbackTokenSent(before);

    const after = harness();
    const callback = await after.app.request(`/callbacks/${callbackToken}/success`, {
      method: "POST",
    });
    expect(callback.status).toBe(404);
    const stream = await after.app.request("/sessions/events", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(stream.status).toBe(401);
  });
});
