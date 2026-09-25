/**
 * The read route against the pinned pygeoapi without CORS (`:5081`), over real
 * HTTP both ways. Nothing is mocked: the unit lane proves what the relay
 * decides, and this lane proves that what it forwards is what the server said.
 *
 * Four claims:
 *
 * 1. A read reaches the server and comes back with the server's status, the
 *    evidence headers and nothing else, marked `X-Relay: 1` and never
 *    `X-Relay-Error` — a forwarded 404 included, because it is the server's.
 * 2. A synchronous execute for a read-route endpoint comes back as the result
 *    itself, not wrapped.
 * 3. A job started asynchronously through the relay can be read and dismissed
 *    through the read route — the three things finding 0049 records as
 *    blocked without it.
 * 4. An endpoint configured direct-only gets nothing forwarded, and the
 *    refusal is marked as the relay's own.
 */

import { once } from "node:events";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AuditLine } from "../../src/app.js";
import { parseConfig } from "../../src/config.js";

const NOCORS = "http://localhost:5081";
const ORIGIN = "http://localhost:4173";

let up = false;
let base = "";
let server: ServerType | undefined;
const audits: AuditLine[] = [];

beforeAll(async () => {
  try {
    up = (await fetch(`${NOCORS}/?f=json`, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    up = false;
  }
  const config = parseConfig({
    allowedOrigins: [ORIGIN],
    endpoints: [
      {
        key: "pygeoapi-nocors-relay",
        baseUrl: NOCORS,
        executeRoute: "relay",
        readRoute: "relay",
        allowPrivateNetwork: true,
      },
      {
        key: "pygeoapi-nocors",
        baseUrl: NOCORS,
        executeRoute: "relay",
        allowPrivateNetwork: true,
      },
    ],
  });
  server = serve({
    fetch: createApp({ config, onAudit: (line) => audits.push(line) }).fetch,
    port: 0,
  });
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("relay has no port");
  base = `http://localhost:${String(address.port)}`;
});

afterAll(async () => {
  if (server === undefined) return;
  if ("closeAllConnections" in server) server.closeAllConnections();
  server.close();
  await once(server, "close").catch(() => undefined);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function session(): Promise<string> {
  const body: unknown = await (await fetch(`${base}/sessions`, { method: "POST" })).json();
  if (!isRecord(body) || typeof body["token"] !== "string") throw new Error("no session");
  return body["token"];
}

async function read(path: string, token: string, method = "GET"): Promise<Response> {
  return fetch(`${base}/read/pygeoapi-nocors-relay${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN, Accept: "application/json" },
  });
}

/** The server's answer to the same request, straight, for comparison. */
async function direct(path: string): Promise<Response> {
  return fetch(`${NOCORS}${path}`, { headers: { Accept: "application/json" } });
}

describe("the read route against pygeoapi without CORS", () => {
  it("hands back the server's answer, marked as forwarded, with the evidence exposed", async (context) => {
    if (!up) context.skip();
    const token = await session();
    const [relayed, straight] = await Promise.all([
      read("/processes?limit=2", token),
      direct("/processes?limit=2"),
    ]);
    expect(relayed.status).toBe(straight.status);
    expect(relayed.headers.get("Content-Type")).toBe(straight.headers.get("Content-Type"));
    expect(await relayed.json()).toEqual(await straight.json());

    expect(relayed.headers.get("X-Relay")).toBe("1");
    expect(relayed.headers.get("X-Relay-Error")).toBeNull();
    expect(relayed.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(relayed.headers.get("Access-Control-Expose-Headers")).toContain("Location");
    // The server's own headers beyond the evidence stay behind.
    expect(straight.headers.get("X-Powered-By")).not.toBeNull();
    expect(relayed.headers.get("X-Powered-By")).toBeNull();

    const line = audits.findLast((entry) => entry.path === "/processes");
    expect(line).toMatchObject({ method: "GET", queryNames: ["limit"], upstreamStatus: 200 });
  });

  it("hands back the server's own 404 as the server's, not the relay's", async (context) => {
    if (!up) context.skip();
    const response = await read("/processes/no-such-process", await session());
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Relay")).toBe("1");
    expect(response.headers.get("X-Relay-Error")).toBeNull();
  });

  it("returns a synchronous execute's result itself", async (context) => {
    if (!up) context.skip();
    const response = await fetch(`${base}/execute/pygeoapi-nocors-relay/hello-world`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Authorization: `Bearer ${await session()}`,
      },
      body: JSON.stringify({ inputs: { name: "relay" } }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Relay")).toBe("1");
    expect(response.headers.get("X-Relay-Error")).toBeNull();
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).toContain("Hello relay");
    expect(isRecord(body) && "upstream" in body).toBe(false);
  });

  it("reads and dismisses a job the relay started", async (context) => {
    if (!up) context.skip();
    const token = await session();
    const started = await fetch(`${base}/execute/pygeoapi-nocors-relay/hello-world`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "respond-async" },
      body: JSON.stringify({ inputs: { name: "relay" } }),
    });
    const envelope: unknown = await started.json();
    const upstream = isRecord(envelope) ? envelope["upstream"] : undefined;
    const location = isRecord(upstream) ? upstream["location"] : undefined;
    if (typeof location !== "string") throw new Error("no Location from the async execute");
    const jobPath = new URL(location).pathname;
    expect(jobPath).toMatch(/^\/jobs\/[^/]+$/);

    const status = await read(`${jobPath}?f=json`, token);
    expect(status.status).toBe(200);
    const job: unknown = await status.json();
    expect(isRecord(job) ? job["jobID"] : undefined).toBe(jobPath.split("/").at(-1));

    const dismissed = await read(jobPath, token, "DELETE");
    expect(dismissed.status).toBeLessThan(300);
    expect(dismissed.headers.get("X-Relay-Error")).toBeNull();
    await dismissed.arrayBuffer();

    const gone = await read(`${jobPath}?f=json`, token);
    expect(gone.status).toBe(404);
    expect(gone.headers.get("X-Relay-Error")).toBeNull();
  });

  it("forwards nothing for an endpoint configured direct-only", async (context) => {
    if (!up) context.skip();
    const before = audits.length;
    const response = await fetch(`${base}/read/pygeoapi-nocors/processes`, {
      headers: { Authorization: `Bearer ${await session()}` },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Relay")).toBe("1");
    expect(response.headers.get("X-Relay-Error")).toBe("read-route-off");
    expect(audits.length).toBe(before);
  });
});
