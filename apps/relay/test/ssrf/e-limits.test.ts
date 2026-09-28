/**
 * SSRF matrix E: what may be sent, how much, for how long, with which headers.
 *
 * Methods, as decided in the audit (ADR 0001): the read route sends `GET`
 * under the base and `DELETE` on one job, `{base}/jobs/{id}`; `/execute` sends
 * `POST` to `{base}/processes/{id}/execution` — raw for a synchronous execute
 * on a read-route endpoint, fixed for an asynchronous one. Every other method
 * and every other path shape is refused with zero outbound requests.
 */

import type http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { parseConfig } from "../../src/config.js";
import { forward } from "../../src/forward.js";
import { postExecute } from "../../src/upstream.js";
import {
  browserRequest,
  countingApp,
  dialStub,
  failure,
  manualSchedule,
  never,
  ORIGIN,
  publicEndpoint,
  relayConfig,
  sessionToken,
  stubServer,
  table,
  type Stub,
} from "./fixtures.js";

const config = parseConfig({
  allowedOrigins: [ORIGIN],
  endpoints: [
    {
      key: "testbed",
      baseUrl: "https://testbed.example/ogc",
      executeRoute: "relay",
      readRoute: "relay",
    },
    { key: "async-only", baseUrl: "https://async.example/ogc", executeRoute: "relay" },
    { key: "direct-only", baseUrl: "https://direct.example/ogc" },
  ],
  limits: { maxExecuteBodyBytes: 1_024 },
});

const JSON_BODY = { "Content-Type": "application/json" };

describe("E — methods and path shapes on the read route", () => {
  it.each(["POST", "PUT", "PATCH"])("%s is refused, and nothing is sent", async (method) => {
    const h = countingApp(config);
    const response = await browserRequest(h.app, "/read/testbed/processes", { method });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("X-Relay-Error")).not.toBeNull();
    expect(h.forwarded).toEqual([]);
  });

  // Hono answers HEAD with the GET handler, which would send a GET upstream.
  it("HEAD is refused, and nothing is sent", async () => {
    const h = countingApp(config);
    const response = await browserRequest(h.app, "/read/testbed/processes", { method: "HEAD" });
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Relay-Error")).toBe("not-found");
    expect(h.forwarded).toEqual([]);
  });

  it("OPTIONS is a CORS preflight, answered by the relay, and nothing is sent", async () => {
    const h = countingApp(config);
    await h.app.request("/read/testbed/processes", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    expect(h.forwarded).toEqual([]);
  });

  it.each([
    "/read/testbed",
    "/read/testbed/",
    "/read/testbed/jobs",
    "/read/testbed/jobs/",
    "/read/testbed/jobs/abc/results",
    "/read/testbed/jobs/abc/results/out",
    "/read/testbed/processes/p",
    "/read/testbed/jobs/a%2Fb",
    "/read/testbed/jobs/..",
  ])("DELETE %s is refused, and nothing is sent", async (path) => {
    const h = countingApp(config);
    const response = await browserRequest(h.app, path, { method: "DELETE" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("X-Relay-Error")).not.toBeNull();
    expect(h.forwarded).toEqual([]);
  });

  it("GET on an endpoint without the read route is refused, and nothing is sent", async () => {
    const h = countingApp(config);
    const response = await browserRequest(h.app, "/read/async-only/processes");
    expect(response.headers.get("X-Relay-Error")).toBe("read-route-off");
    expect(h.forwarded).toEqual([]);
  });

  it("control: GET under the base and DELETE on one job are sent, with their own method", async () => {
    const h = countingApp(config);
    await browserRequest(h.app, "/read/testbed/processes");
    await browserRequest(h.app, "/read/testbed/jobs/abc", { method: "DELETE", body: "ignored" });
    expect(h.forwarded.map((r) => [r.method, r.url.toString(), r.body])).toEqual([
      ["GET", "https://testbed.example/ogc/processes", undefined],
      // A DELETE carries no body upstream, whatever the browser sent.
      ["DELETE", "https://testbed.example/ogc/jobs/abc", undefined],
    ]);
  });
});

describe("E — methods and path shapes on /execute", () => {
  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD"])(
    "%s /execute/testbed/p is refused, and nothing is sent",
    async (method) => {
      const h = countingApp(config);
      const response = await browserRequest(h.app, "/execute/testbed/p", { method });
      expect(response.status).toBeGreaterThanOrEqual(400);
      if (method !== "HEAD") expect(response.headers.get("X-Relay-Error")).not.toBeNull();
      expect(h.forwarded).toEqual([]);
      expect(h.executed).toEqual([]);
    },
  );

  it.each([
    "/execute/testbed",
    "/execute/testbed/p/extra",
    "/execute/testbed/..",
    "/execute/testbed/%2e%2e",
    "/execute/testbed/.hidden",
    "/execute/testbed/a%2Fb",
    "/execute/testbed/a%5Cb",
    "/execute/testbed/@evil.example",
    "/execute/testbed/http:%2F%2Fevil.example",
    "/execute/testbed/:p",
    "/execute/testbed/%3Ap",
    "/execute/testbed/p%3Fx=1",
    "/execute/testbed/p%23x",
    "/execute/unknown/p",
    "/execute/direct-only/p",
  ])("POST %s is refused, and nothing is sent", async (path) => {
    for (const prefer of [undefined, "respond-async"]) {
      const h = countingApp(config);
      const response = await browserRequest(h.app, path, {
        method: "POST",
        headers: { ...JSON_BODY, ...(prefer === undefined ? {} : { Prefer: prefer }) },
        body: "{}",
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("X-Relay-Error")).not.toBeNull();
      expect(h.forwarded).toEqual([]);
      expect(h.executed).toEqual([]);
    }
  });

  it("control: synchronous and asynchronous executes are sent as POST to the execution URL", async () => {
    const h = countingApp(config);
    await browserRequest(h.app, "/execute/testbed/p.1~x", {
      method: "POST",
      headers: JSON_BODY,
      body: "{}",
    });
    await browserRequest(h.app, "/execute/async-only/p", {
      method: "POST",
      headers: { ...JSON_BODY, Prefer: "respond-async" },
      body: "{}",
    });
    expect(h.forwarded.map((r) => [r.method, r.url.toString()])).toEqual([
      ["POST", "https://testbed.example/ogc/processes/p.1~x/execution"],
    ]);
    expect(h.executed).toEqual(["async-only/p"]);
  });

  it("control: a namespaced id with colons is sent, percent-encoded into its own segment", async () => {
    const h = countingApp(config);
    // The browser encodes the colons; a literal colon must mean the same.
    for (const id of ["ns%3Ap%3Av1", "ns:p:v1"]) {
      await browserRequest(h.app, `/execute/testbed/${id}`, {
        method: "POST",
        headers: JSON_BODY,
        body: "{}",
      });
    }
    await browserRequest(h.app, "/execute/async-only/ns%3Ap%3Av1", {
      method: "POST",
      headers: { ...JSON_BODY, Prefer: "respond-async" },
      body: "{}",
    });
    expect(h.forwarded.map((r) => [r.method, r.url.toString()])).toEqual([
      ["POST", "https://testbed.example/ogc/processes/ns%3Ap%3Av1/execution"],
      ["POST", "https://testbed.example/ogc/processes/ns%3Ap%3Av1/execution"],
    ]);
    expect(h.executed).toEqual(["async-only/ns:p:v1"]);
  });
});

describe("E — request body cap", () => {
  it.each([undefined, "respond-async"])(
    "an execute body over the cap is refused before anything is sent (Prefer: %s)",
    async (prefer) => {
      const h = countingApp(config);
      const response = await browserRequest(h.app, "/execute/testbed/p", {
        method: "POST",
        headers: { ...JSON_BODY, ...(prefer === undefined ? {} : { Prefer: prefer }) },
        body: JSON.stringify({ inputs: { x: "a".repeat(2_048) } }),
      });
      expect(response.status).toBe(413);
      expect(response.headers.get("X-Relay-Error")).toBe("body-too-large");
      expect(h.forwarded).toEqual([]);
      expect(h.executed).toEqual([]);
    },
  );

  it("an execute body over the cap without Content-Length is refused too", async () => {
    const h = countingApp(config);
    const token = await sessionToken(h.app);
    const chunk = new TextEncoder().encode(`{"x":"${"a".repeat(2_048)}"}`);
    const response = await h.app.request("/execute/testbed/p", {
      method: "POST",
      headers: { ...JSON_BODY, Authorization: `Bearer ${token}`, Origin: ORIGIN },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    });
    expect(response.status).toBe(413);
    expect(h.forwarded).toEqual([]);
  });
});

describe("E — on the wire", () => {
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

  const HOST = "testbed.example";
  const base = (): string => `http://${HOST}:${String(stub.port)}/ogc`;
  const dns = table({ [HOST]: ["93.184.215.14"] });

  /** Everything a browser, or a proxy in front of the relay, might attach. */
  const HOSTILE_HEADERS = {
    Cookie: "session=secret",
    "X-Forwarded-For": "10.0.0.1",
    "X-Forwarded-Host": "internal.example",
    "X-Forwarded-Proto": "https",
    Forwarded: "for=10.0.0.1;host=internal.example",
    "X-Real-IP": "10.0.0.1",
    Referer: "https://client.example/secret-page",
    "Proxy-Authorization": "Basic c2VjcmV0",
    "X-Custom": "anything",
    "X-HTTP-Method-Override": "DELETE",
  };
  const ALLOWED_UPSTREAM = new Set([
    "host",
    "connection",
    "user-agent",
    "accept",
    "accept-language",
    "prefer",
    "content-type",
    "content-length",
  ]);

  function app() {
    const wireLimits = { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: never };
    return createApp({
      config: relayConfig([
        publicEndpoint(base()),
        publicEndpoint(`http://127.0.0.1:${String(stub.port)}/ogc`, {
          key: "async-stub",
          readRoute: "direct",
          // Dialled directly: this test is about headers, not addresses.
          allowPrivateNetwork: true,
        }),
      ]),
      schedule: never,
      forward: (e, request) => forward(e, request, { ...wireLimits, lookup: dialStub(dns) }),
      upstream: (e, processId, body) => postExecute(e, processId, body, wireLimits),
      onAudit: () => undefined,
    });
  }

  function expectOnlyAllowlisted(seen: http.IncomingHttpHeaders, label: string): void {
    for (const name of Object.keys(seen))
      expect(ALLOWED_UPSTREAM, `${label}: ${name}`).toContain(name);
    expect(seen.authorization, label).toBeUndefined();
    expect(seen.cookie, label).toBeUndefined();
    expect(seen.origin, label).toBeUndefined();
  }

  it("a read sends only allowlisted headers — no cookie, authorization, origin or forwarding headers", async () => {
    stub.on("/ogc/processes", (_request, response) => {
      response.writeHead(200).end("{}");
    });
    const response = await browserRequest(app(), "/read/testbed/processes", {
      headers: { ...HOSTILE_HEADERS, Accept: "application/json", "Accept-Language": "nl" },
    });
    await response.text();
    const [seen] = stub.requests;
    expect(seen?.method).toBe("GET");
    expect(seen?.headers.host).toBe(`${HOST}:${String(stub.port)}`);
    expect(seen?.headers.accept).toBe("application/json");
    expectOnlyAllowlisted(seen?.headers ?? {}, "read");
  });

  it("a synchronous execute: likewise", async () => {
    stub.on("/ogc/processes/p/execution", (_request, response) => {
      response.writeHead(200).end("{}");
    });
    const response = await browserRequest(app(), "/execute/testbed/p", {
      method: "POST",
      headers: { ...HOSTILE_HEADERS, ...JSON_BODY },
      body: "{}",
    });
    await response.text();
    const [seen] = stub.requests;
    expect(seen?.method).toBe("POST");
    expectOnlyAllowlisted(seen?.headers ?? {}, "sync execute");
  });

  it("an asynchronous execute sends fixed headers, whatever the browser sent", async () => {
    stub.on("/ogc/processes/p/execution", (_request, response) => {
      response.writeHead(201, { Location: "/ogc/jobs/1" }).end();
    });
    const response = await browserRequest(app(), "/execute/async-stub/p", {
      method: "POST",
      headers: {
        ...HOSTILE_HEADERS,
        ...JSON_BODY,
        Prefer: "respond-async, wait=10",
        Accept: "text/html",
      },
      body: "{}",
    });
    await response.text();
    const [seen] = stub.requests;
    expect(seen?.method).toBe("POST");
    expect(seen?.headers.prefer).toBe("respond-async");
    expect(seen?.headers.accept).toBe("*/*");
    expectOnlyAllowlisted(seen?.headers ?? {}, "async execute");
  });

  /** 600-byte chunks, never ended: only a cap can finish this, never the end of the body. */
  function endless(_request: http.IncomingMessage, response: http.ServerResponse): void {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    for (let i = 0; i < 4; i++) response.write("x".repeat(600));
  }

  it("the read route's response cap is enforced while streaming, not after", async () => {
    stub.on("/ogc/endless", endless);
    const forwarded = await forward(
      publicEndpoint(base()),
      { method: "GET", url: new URL(`${base()}/endless`), headers: new Headers() },
      { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: never, lookup: dialStub(dns) },
    );
    await expect(new Response(forwarded.body).arrayBuffer()).rejects.toThrow();
    await expect(forwarded.done).resolves.toMatchObject({ capHit: "bytes" });
  });

  it("the asynchronous execute's response cap is enforced while streaming, not after", async () => {
    stub.on("/ogc/processes/p/execution", endless);
    const reason = await failure(
      postExecute(
        publicEndpoint(`http://127.0.0.1:${String(stub.port)}/ogc`, { allowPrivateNetwork: true }),
        "p",
        "{}",
        { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: never },
      ),
    );
    expect(reason).toBe("response-too-large");
  });

  /** Holds the request open, and says when it arrived and when its socket closed. */
  function silent(): {
    handler: (request: http.IncomingMessage) => void;
    arrived: Promise<void>;
    closed: Promise<void>;
  } {
    let arrive = (): void => undefined;
    let close = (): void => undefined;
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    const closed = new Promise<void>((resolve) => (close = resolve));
    return {
      handler: (request) => {
        request.socket.on("close", close);
        arrive();
      },
      arrived,
      closed,
    };
  }

  it("the read route's deadline ends a silent upstream, and drops its socket", async () => {
    const quiet = silent();
    stub.on("/ogc/silent", quiet.handler);
    const deadline = manualSchedule();
    const pending = failure(
      forward(
        publicEndpoint(base()),
        { method: "GET", url: new URL(`${base()}/silent`), headers: new Headers() },
        {
          timeoutMs: 5_000,
          maxResponseBytes: 1_024,
          schedule: deadline.schedule,
          lookup: dialStub(dns),
        },
      ),
    );
    await quiet.arrived;
    deadline.fire();
    expect(await pending).toBe("timeout");
    await quiet.closed;
  });

  it("the asynchronous execute's deadline: likewise", async () => {
    const quiet = silent();
    stub.on("/ogc/processes/p/execution", quiet.handler);
    const deadline = manualSchedule();
    const pending = failure(
      postExecute(
        publicEndpoint(`http://127.0.0.1:${String(stub.port)}/ogc`, { allowPrivateNetwork: true }),
        "p",
        "{}",
        { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: deadline.schedule },
      ),
    );
    await quiet.arrived;
    deadline.fire();
    expect(await pending).toBe("timeout");
    await quiet.closed;
  });
});
