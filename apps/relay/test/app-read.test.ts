/**
 * The read route and the two markers, end to end in process. The outbound
 * request is a function here, as the execute is in `app.test.ts`; what it
 * does on the wire is `forward.test.ts`'s business.
 */

import { describe, expect, it } from "vitest";
import {
  createApp,
  EXPOSED_HEADERS,
  type AuditLine,
  type ForwardCall,
  type UpstreamCall,
} from "../src/app.js";
import { parseConfig } from "../src/config.js";
import type { ForwardedResponse, ForwardRequest } from "../src/forward.js";
import { RelayState, type Clock } from "../src/state.js";
import { UpstreamError, type UpstreamResponse } from "../src/upstream.js";

const ORIGIN = "http://localhost:4173";

const config = parseConfig({
  allowedOrigins: [ORIGIN],
  endpoints: [
    {
      key: "zoo",
      baseUrl: "http://zoo.test/ogc-api",
      executeRoute: "relay",
      readRoute: "relay",
    },
    { key: "async-only", baseUrl: "http://ogc.test", executeRoute: "relay" },
  ],
  sessionIdleTtlMs: 60_000,
});

const CREATED: UpstreamResponse = {
  status: 201,
  location: "http://zoo.test/ogc-api/jobs/abc",
  contentType: "application/json",
  preferenceApplied: "respond-async",
  body: "{}",
};

function answer(
  status: number,
  body: string | Uint8Array | null,
  headers: Record<string, string> = {},
): ForwardedResponse {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return {
    status,
    headers: new Headers(headers),
    body:
      bytes === null
        ? null
        : new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
    finalUrl: "http://zoo.test/ogc-api/",
    redirectsFollowed: 0,
    done: Promise.resolve({ bytes: bytes?.byteLength ?? 0, capHit: undefined }),
  };
}

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly clock: Clock & { advance(ms: number): void };
  readonly forwarded: ForwardRequest[];
  readonly executed: string[];
  readonly audits: AuditLine[];
}

function harness(
  reply: (request: ForwardRequest) => Promise<ForwardedResponse> = () =>
    Promise.resolve(answer(200, "{}", { "Content-Type": "application/json" })),
): Harness {
  let now = 1_000_000;
  const clock = {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  const state = new RelayState(clock, {
    registrationTtlMs: 60_000,
    sessionIdleTtlMs: config.sessionIdleTtlMs,
    maxSessions: 10,
    maxRegistrationsPerSession: 10,
  });
  const forwarded: ForwardRequest[] = [];
  const executed: string[] = [];
  const audits: AuditLine[] = [];
  const forward: ForwardCall = (_endpoint, request) => {
    forwarded.push(request);
    clock.advance(7);
    return reply(request);
  };
  const upstream: UpstreamCall = (endpoint) => {
    executed.push(endpoint.key);
    return Promise.resolve(CREATED);
  };
  const app = createApp({
    config,
    state,
    clock,
    schedule: () => () => undefined,
    forward,
    upstream,
    onAudit: (line) => audits.push(line),
  });
  return { app, clock, forwarded, executed, audits };
}

async function session(app: Harness["app"]): Promise<string> {
  const body: unknown = await (await app.request("/sessions", { method: "POST" })).json();
  if (typeof body !== "object" || body === null || !("token" in body)) throw new Error("no token");
  const { token } = body;
  if (typeof token !== "string") throw new Error("token is not a string");
  return token;
}

async function read(
  h: Harness,
  path: string,
  init: { readonly method?: string; readonly headers?: Record<string, string> } = {},
): Promise<Response> {
  const token = await session(h.app);
  return h.app.request(path, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN, ...init.headers },
  });
}

describe("GET /read — refusals", () => {
  it("answers 404 for an endpoint it does not know", async () => {
    const h = harness();
    const response = await read(h, "/read/nope/processes");
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Relay-Error")).toBe("unknown-endpoint");
    expect(h.forwarded).toEqual([]);
  });

  it("answers 403 for an endpoint not configured for the read route", async () => {
    const h = harness();
    const response = await read(h, "/read/async-only/processes");
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Relay-Error")).toBe("read-route-off");
    expect(h.forwarded).toEqual([]);
  });

  it.each([
    ["no Authorization", undefined],
    ["a malformed token", "Bearer not a token"],
    ["an unknown token", `Bearer ${"A".repeat(43)}`],
  ])("answers 401 for %s", async (_, authorization) => {
    const h = harness();
    const response = await h.app.request("/read/zoo/processes", {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Relay-Error")).toBe("unknown-session");
    expect(h.forwarded).toEqual([]);
  });

  it("answers 401 for a session that expired", async () => {
    const h = harness();
    const token = await session(h.app);
    h.clock.advance(config.sessionIdleTtlMs + 1);
    const response = await h.app.request("/read/zoo/processes", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
    expect(h.forwarded).toEqual([]);
  });

  it.each([
    ["an absolute URL", "/read/zoo/http:/evil.example/x", "absolute-url"],
    ["a protocol-relative path", "/read/zoo//evil.example/x", "absolute-url"],
    ["an encoded slash", "/read/zoo/jobs/..%2F..%2Fadmin", "encoded-separator"],
  ])("answers 400 for %s", async (_, path, code) => {
    const h = harness();
    const response = await read(h, path);
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Relay-Error")).toBe(code);
    expect(h.forwarded).toEqual([]);
  });

  it("never forwards a path that climbs out with ..", async () => {
    const h = harness();
    // URL parsing removes the dot segments before the route sees the path, so
    // this arrives as /etc/passwd — which no route matches.
    const response = await read(h, "/read/zoo/../../etc/passwd");
    expect(response.status).toBe(404);
    expect(h.forwarded).toEqual([]);
  });

  it.each(["/read/zoo/processes/echo", "/read/zoo/jobs", "/read/zoo/jobs/abc/results"])(
    "refuses DELETE on %s, which is not one job",
    async (path) => {
      const h = harness();
      const response = await read(h, path, { method: "DELETE" });
      expect(response.status).toBe(405);
      expect(response.headers.get("X-Relay-Error")).toBe("delete-not-a-job");
      expect(h.forwarded).toEqual([]);
    },
  );
});

describe("GET /read — forwarding", () => {
  it("resolves the path under the base and keeps the query string verbatim", async () => {
    const h = harness();
    await read(h, "/read/zoo/processes?f=json&limit=10&q=a%20b");
    expect(h.forwarded.map((request) => [request.method, request.url.href])).toEqual([
      ["GET", "http://zoo.test/ogc-api/processes?f=json&limit=10&q=a%20b"],
    ]);
  });

  it("reads the base itself, with and without its trailing slash", async () => {
    const h = harness();
    await read(h, "/read/zoo");
    await read(h, "/read/zoo/");
    expect(h.forwarded.map((request) => request.url.href)).toEqual([
      "http://zoo.test/ogc-api",
      "http://zoo.test/ogc-api/",
    ]);
  });

  it("forwards DELETE on one job", async () => {
    const h = harness(() => Promise.resolve(answer(200, "{}")));
    const response = await read(h, "/read/zoo/jobs/abc-123", { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(h.forwarded.map((request) => [request.method, request.url.pathname])).toEqual([
      ["DELETE", "/ogc-api/jobs/abc-123"],
    ]);
  });

  it("hands back the status, the headers and the body, and marks it as forwarded, not refused", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const h = harness(() =>
      Promise.resolve(
        answer(500, png, {
          "Content-Type": "image/png",
          "Content-Crs": "<http://www.opengis.net/def/crs/OGC/1.3/CRS84>",
        }),
      ),
    );
    const response = await read(h, "/read/zoo/jobs/abc/results");
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Crs")).toBe(
      "<http://www.opengis.net/def/crs/OGC/1.3/CRS84>",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    // The server's own 500: the relay's marker, and no relay error.
    expect(response.headers.get("X-Relay")).toBe("1");
    expect(response.headers.get("X-Relay-Error")).toBeNull();
  });

  it("exposes every evidence header, and both markers, to the page", async () => {
    const h = harness();
    const response = await read(h, "/read/zoo/processes");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const exposed = (response.headers.get("Access-Control-Expose-Headers") ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase());
    for (const name of [
      "content-type",
      "content-length",
      "content-crs",
      "content-disposition",
      "location",
      "retry-after",
      "link",
      "preference-applied",
      "x-relay",
      "x-relay-error",
    ]) {
      expect(exposed).toContain(name);
    }
    expect(EXPOSED_HEADERS).toHaveLength(10);
  });

  it("answers a preflight for GET and DELETE with the forwarded request headers", async () => {
    const h = harness();
    const response = await h.app.request("/read/zoo/jobs/abc", {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "DELETE",
        "Access-Control-Request-Headers": "authorization,prefer",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
    expect(response.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("prefer");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("X-Relay")).toBe("1");
  });

  it("answers 502, marked as its own, when the exchange produced no response", async () => {
    const h = harness(() => Promise.reject(new UpstreamError("timeout")));
    const response = await read(h, "/read/zoo/processes");
    expect(response.status).toBe(502);
    expect(response.headers.get("X-Relay-Error")).toBe("timeout");
    await expect(response.json()).resolves.toMatchObject({ reason: "timeout" });
  });
});

describe("markers", () => {
  it("puts X-Relay on every response, and X-Relay-Error on every one it generates itself", async () => {
    const h = harness();
    const token = await session(h.app);
    const own = [
      await h.app.request("/nowhere"),
      await h.app.request("/read/zoo/processes"),
      await h.app.request("/sessions/events"),
      await h.app.request("/execute/nope/echo", { method: "POST" }),
      await h.app.request("/execute/zoo/bad%20id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      await h.app.request("/read/zoo/jobs/x/results", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
    ];
    for (const response of own) {
      expect(response.headers.get("X-Relay")).toBe("1");
      expect(response.headers.get("X-Relay-Error")).toMatch(/^[a-z-]+$/);
    }
    const fine = [
      await h.app.request("/healthz"),
      await h.app.request("/endpoints"),
      await h.app.request("/read/zoo/", { headers: { Authorization: `Bearer ${token}` } }),
    ];
    for (const response of fine) {
      expect(response.headers.get("X-Relay")).toBe("1");
      expect(response.headers.get("X-Relay-Error")).toBeNull();
    }
  });

  it("marks the error handler's own 500 too", async () => {
    const h = harness(() =>
      Promise.resolve({
        ...answer(200, "{}"),
        get headers(): Headers {
          throw new Error("boom");
        },
      }),
    );
    const response = await read(h, "/read/zoo/processes");
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Relay")).toBe("1");
    expect(response.headers.get("X-Relay-Error")).toBe("internal-error");
  });
});

describe("audit", () => {
  it("writes one redacted line per forwarded read: path, query names, never values", async () => {
    const h = harness(() =>
      Promise.resolve({
        ...answer(200, "abc"),
        done: Promise.resolve({ bytes: 3, capHit: undefined }),
      }),
    );
    const response = await read(h, "/read/zoo/jobs?status=running&limit=5&api_key=SECRET");
    await response.text();
    await Promise.resolve();
    expect(h.audits).toEqual([
      {
        audit: "read-route",
        endpointKey: "zoo",
        method: "GET",
        path: "/jobs",
        queryNames: ["api_key", "limit", "status"],
        upstreamStatus: 200,
        failure: undefined,
        redirectsFollowed: 0,
        bytes: 3,
        ms: 7,
        capHit: undefined,
      },
    ]);
    expect(JSON.stringify(h.audits)).not.toContain("SECRET");
  });

  it("records a cap hit while the body streamed", async () => {
    const h = harness(() =>
      Promise.resolve({
        ...answer(200, "partial"),
        done: Promise.resolve({ bytes: 1_024, capHit: "bytes" as const }),
      }),
    );
    await read(h, "/read/zoo/jobs/abc/results");
    await Promise.resolve();
    expect(h.audits[0]).toMatchObject({
      upstreamStatus: 200,
      capHit: "bytes",
      failure: "response-too-large",
    });
  });

  it("records a cap hit before any response, with no status", async () => {
    const h = harness(() => Promise.reject(new UpstreamError("response-too-large")));
    const response = await read(h, "/read/zoo/jobs/abc/results");
    expect(response.status).toBe(502);
    expect(h.audits[0]).toMatchObject({
      upstreamStatus: undefined,
      capHit: "bytes",
      failure: "response-too-large",
    });
  });

  it("writes nothing for a refusal, since nothing was forwarded", async () => {
    const h = harness();
    await read(h, "/read/async-only/processes");
    expect(h.audits).toEqual([]);
  });
});

describe("POST /execute for a read-route endpoint", () => {
  const body = JSON.stringify({ inputs: { a: 1 } });

  it("forwards a synchronous execute raw, and hands back the result itself", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const h = harness(() => Promise.resolve(answer(200, png, { "Content-Type": "image/png" })));
    const response = await h.app.request("/execute/zoo/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(h.forwarded.map((request) => [request.method, request.url.href, request.body])).toEqual([
      ["POST", "http://zoo.test/ogc-api/processes/echo/execution", body],
    ]);
    expect(h.executed).toEqual([]);
    await Promise.resolve();
    expect(h.audits[0]).toMatchObject({ method: "POST", path: "/processes/echo/execution" });
  });

  it("sends an asynchronous execute the way it always has", async () => {
    const h = harness();
    const response = await h.app.request("/execute/zoo/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "respond-async" },
      body,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ upstream: CREATED });
    expect(h.executed).toEqual(["zoo"]);
    expect(h.forwarded).toEqual([]);
  });

  it("leaves an endpoint without the read route on the asynchronous route", async () => {
    const h = harness();
    await h.app.request("/execute/async-only/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(h.executed).toEqual(["async-only"]);
    expect(h.forwarded).toEqual([]);
  });

  it("still refuses a browser-supplied subscriber before forwarding", async () => {
    const h = harness();
    const response = await h.app.request("/execute/zoo/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: {}, subscriber: { successUri: "http://evil.example" } }),
    });
    expect(response.status).toBe(400);
    expect(h.forwarded).toEqual([]);
  });
});
