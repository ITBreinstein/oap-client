/**
 * SSRF matrix F: what a blocked request tells the browser, and what it logs.
 *
 * The browser gets a reason code and nothing else: no resolved address, no
 * hostname, no port, no upstream body, no resolver message. The operator gets
 * one structured audit line per block, redacted the same way as every read:
 * the path relative to the base and the query's parameter names, never a
 * value, a token or a header.
 */

import { describe, expect, it } from "vitest";
import { createApp, type AuditLine } from "../../src/app.js";
import type { EndpointConfig } from "../../src/config.js";
import { forward } from "../../src/forward.js";
import { UpstreamError } from "../../src/exchange.js";
import { postExecute } from "../../src/upstream.js";
import {
  countingApp,
  dialStub,
  never,
  ORIGIN,
  publicEndpoint,
  relayConfig,
  sessionToken,
  stubServer,
  table,
} from "./fixtures.js";

const INTERNAL_HOST = "internal.testbed.example";
const INTERNAL_IP = "10.1.2.3";
const SECRET = "hunter2";

const limits = { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: never };

function blockingApp(endpoint: EndpointConfig, audits: AuditLine[]) {
  const resolve = table({ [INTERNAL_HOST]: [INTERNAL_IP] });
  return createApp({
    config: relayConfig([endpoint]),
    schedule: never,
    forward: (e, request) => forward(e, request, { ...limits, resolve }),
    upstream: (e, processId, body) => postExecute(e, processId, body, { ...limits, resolve }),
    onAudit: (line) => audits.push(line),
  });
}

/** Nothing the relay learned about the destination, or was sent by the browser, may come back. */
async function expectBareRefusal(response: Response, leaks: readonly string[]): Promise<void> {
  expect(response.status).toBe(502);
  expect(response.headers.get("X-Relay-Error")).toBe("blocked-address");
  const text = await response.text();
  const body: unknown = JSON.parse(text);
  expect(body).toEqual({
    type: "about:blank",
    title: "Bad Gateway",
    status: 502,
    reason: "blocked-address",
  });
  const everything = [
    text,
    ...[...response.headers].map(([name, value]) => `${name}: ${value}`),
  ].join("\n");
  for (const leak of [...leaks, "refused", "ENOTFOUND", "getaddrinfo"]) {
    expect(everything, leak).not.toContain(leak);
  }
}

function expectRedacted(line: AuditLine | undefined, leaks: readonly string[]): void {
  expect(line).toBeDefined();
  const serialised = JSON.stringify(line);
  for (const leak of leaks) expect(serialised, leak).not.toContain(leak);
}

describe("F — a blocked read", () => {
  it.each([
    ["by DNS answer", `http://${INTERNAL_HOST}:8080/ogc`, [INTERNAL_HOST, INTERNAL_IP, "8080"]],
    ["by host literal", "http://169.254.169.254:8080/ogc", ["169.254", "8080"]],
  ])("%s: a bare reason code, and one redacted audit line", async (_label, baseUrl, leaks) => {
    const audits: AuditLine[] = [];
    const app = blockingApp(publicEndpoint(baseUrl), audits);
    const token = await sessionToken(app);

    const response = await app.request(`/read/testbed/processes?secret=${SECRET}&page=2`, {
      headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN },
    });

    await expectBareRefusal(response, [...leaks, SECRET, token]);
    expect(audits).toEqual([
      expect.objectContaining({
        endpointKey: "testbed",
        method: "GET",
        path: "/processes",
        queryNames: ["page", "secret"],
        upstreamStatus: undefined,
        failure: "blocked-address",
      }),
    ]);
    expectRedacted(audits[0], [...leaks, SECRET, token]);
  });

  it("at a redirect hop: a bare reason code, and one redacted audit line", async () => {
    const stub = await stubServer();
    try {
      stub.on("/ogc/jobs/1", (_request, response) => {
        response.writeHead(302, { Location: "/ogc/jobs/1/" }).end();
      });
      const audits: AuditLine[] = [];
      const baseUrl = `http://${INTERNAL_HOST}:${String(stub.port)}/ogc`;
      // Public for the first hop, which reaches the stub; private for the second.
      const rebinding = table({
        [INTERNAL_HOST]: (call) => (call === 1 ? ["93.184.215.14"] : [INTERNAL_IP]),
      });
      const app = createApp({
        config: relayConfig([publicEndpoint(baseUrl)]),
        schedule: never,
        forward: (e, request) => forward(e, request, { ...limits, lookup: dialStub(rebinding) }),
        onAudit: (line) => audits.push(line),
      });
      const token = await sessionToken(app);
      const response = await app.request("/read/testbed/jobs/1", {
        headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN },
      });

      expect(stub.requests.map((r) => r.url)).toEqual(["/ogc/jobs/1"]);
      await expectBareRefusal(response, [INTERNAL_HOST, INTERNAL_IP, String(stub.port), token]);
      expect(audits).toEqual([
        expect.objectContaining({ path: "/jobs/1", failure: "blocked-address" }),
      ]);
      expectRedacted(audits[0], [INTERNAL_HOST, INTERNAL_IP, token]);
    } finally {
      await stub.close();
    }
  });
});

describe("F — a blocked execute", () => {
  it("synchronous: a bare reason code, and one redacted audit line", async () => {
    const audits: AuditLine[] = [];
    const app = blockingApp(publicEndpoint(`http://${INTERNAL_HOST}:8080/ogc`), audits);
    const token = await sessionToken(app);
    const response = await app.request("/execute/testbed/p", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: { secret: SECRET } }),
    });
    await expectBareRefusal(response, [INTERNAL_HOST, INTERNAL_IP, "8080", SECRET, token]);
    expect(audits).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/processes/p/execution",
        failure: "blocked-address",
      }),
    ]);
    expectRedacted(audits[0], [INTERNAL_HOST, INTERNAL_IP, SECRET, token]);
  });

  it("asynchronous: a bare reason code", async () => {
    const audits: AuditLine[] = [];
    const app = blockingApp(
      publicEndpoint(`http://${INTERNAL_HOST}:8080/ogc`, { readRoute: "direct" }),
      audits,
    );
    const token = await sessionToken(app);
    const response = await app.request("/execute/testbed/p", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
        "Content-Type": "application/json",
        Prefer: "respond-async",
      },
      body: JSON.stringify({ inputs: { secret: SECRET } }),
    });
    await expectBareRefusal(response, [INTERNAL_HOST, INTERNAL_IP, "8080", SECRET, token]);
  });

  it("asynchronous: one redacted audit line, as for a read", async () => {
    const audits: AuditLine[] = [];
    const app = blockingApp(
      publicEndpoint(`http://${INTERNAL_HOST}:8080/ogc`, { readRoute: "direct" }),
      audits,
    );
    const token = await sessionToken(app);
    await app.request("/execute/testbed/p", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
        "Content-Type": "application/json",
        Prefer: "respond-async",
      },
      body: JSON.stringify({ inputs: { secret: SECRET } }),
    });
    expect(audits).toEqual([
      expect.objectContaining({
        audit: "execute",
        endpointKey: "testbed",
        method: "POST",
        path: "/processes/p/execution",
        queryNames: [],
        upstreamStatus: undefined,
        failure: "blocked-address",
      }),
    ]);
    expectRedacted(audits[0], [INTERNAL_HOST, INTERNAL_IP, SECRET, token]);
  });
});

describe("F — the asynchronous execute's audit line, beyond blocks", () => {
  const endpoint = publicEndpoint("https://ogc.example.org/ogc", { readRoute: "direct" });
  const execute = async (app: ReturnType<typeof createApp>): Promise<Response> =>
    app.request("/execute/testbed/p", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", Prefer: "respond-async" },
      body: "{}",
    });

  it("a timeout writes it too, naming the failure", async () => {
    const audits: AuditLine[] = [];
    const app = createApp({
      config: relayConfig([endpoint]),
      schedule: never,
      upstream: () => Promise.reject(new UpstreamError("timeout")),
      onAudit: (line) => audits.push(line),
    });
    const response = await execute(app);
    expect(response.headers.get("X-Relay-Error")).toBe("timeout");
    expect(audits).toEqual([
      expect.objectContaining({ audit: "execute", failure: "timeout", capHit: "duration" }),
    ]);
  });

  it("an execute the server answered writes none", async () => {
    const h = countingApp(relayConfig([endpoint]));
    const response = await execute(h.app);
    expect(response.status).toBe(200);
    expect(h.audits).toEqual([]);
  });
});
