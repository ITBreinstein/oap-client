/**
 * A forwarded body through the real listener (`@hono/node-server`), not
 * `app.request()`: the listener decides how a body of undeclared length goes
 * out, and it is where a short body used to be presented as whole.
 *
 * Without `Transfer-Encoding: chunked`, the listener reads the first few
 * chunks before writing anything, takes a read error there for the end of the
 * body, and answers with a Content-Length equal to what it had (review R1).
 * Both ways a body can break off early (the server dies, or the relay's byte
 * cap) must reach the browser as a failed read, and the audit line must say
 * which (review R11).
 */

import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AuditLine } from "../src/app.js";
import { publicEndpoint, relayConfig } from "./ssrf/fixtures.js";

let upstream: http.Server;
let upstreamPort = 0;

beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    if (request.url === "/ogc/crash") {
      // Headers and the first part of the body, then the server dies.
      response.writeHead(200, { "Content-Type": "image/png" });
      response.write("partial-body");
      setImmediate(() => response.socket?.destroy());
      return;
    }
    if (request.url === "/ogc/big") {
      // More than a 1 KiB cap, never declared, never ended.
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      for (let i = 0; i < 4; i++) response.write("x".repeat(600));
      return;
    }
    if (request.url === "/ogc/chunked") {
      response.writeHead(200, { "Content-Type": "text/csv" });
      response.write("a,b\n");
      setImmediate(() => response.end("1,2\n"));
      return;
    }
    if (request.url === "/ogc/declared") {
      response.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "5" });
      response.end("whole");
      return;
    }
    response.writeHead(404).end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  upstreamPort = (upstream.address() as AddressInfo).port;
});

afterAll(async () => {
  upstream.closeAllConnections();
  upstream.close();
  await once(upstream, "close").catch(() => undefined);
});

interface Relay {
  readonly base: string;
  readonly server: ServerType;
  readonly audits: AuditLine[];
}

async function relay(maxReadResponseBytes: number): Promise<Relay> {
  const audits: AuditLine[] = [];
  const config = relayConfig(
    [publicEndpoint(`http://127.0.0.1:${String(upstreamPort)}/ogc`, { allowPrivateNetwork: true })],
    { maxReadResponseBytes },
  );
  const server = serve({
    fetch: createApp({ config, onAudit: (line) => audits.push(line) }).fetch,
    port: 0,
    hostname: "127.0.0.1",
  });
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${String(address.port)}`, server, audits };
}

interface Read {
  readonly status: number;
  readonly contentLength: string | null;
  /** The body, or `undefined` when reading it failed. */
  readonly body: string | undefined;
}

async function read(base: string, path: string): Promise<Read> {
  const session = (await (await fetch(`${base}/sessions`, { method: "POST" })).json()) as {
    token: string;
  };
  const response = await fetch(`${base}/read/testbed${path}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  let body: string | undefined;
  try {
    body = await response.text();
  } catch {
    body = undefined;
  }
  return { status: response.status, contentLength: response.headers.get("content-length"), body };
}

/** The audit line is written when the body is done, which can be after the read settles. */
async function lastAudit(audits: readonly AuditLine[]): Promise<AuditLine | undefined> {
  for (let i = 0; i < 50 && audits.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return audits.at(-1);
}

async function stop(server: ServerType): Promise<void> {
  server.close();
  await once(server, "close").catch(() => undefined);
}

describe("a body that breaks off early, through the real listener", () => {
  it("fails the read when the server dies after the first chunk, and audits connection-failed", async () => {
    const { base, server, audits } = await relay(50 * 1024 * 1024);
    try {
      const result = await read(base, "/crash");
      expect(result.body).toBeUndefined();
      expect(await lastAudit(audits)).toMatchObject({
        failure: "connection-failed",
        capHit: undefined,
        bytes: 12,
      });
    } finally {
      await stop(server);
    }
  });

  it("fails the read when the byte cap is hit in the second chunk, and audits it", async () => {
    const { base, server, audits } = await relay(1_024);
    try {
      const result = await read(base, "/big");
      expect(result.body).toBeUndefined();
      expect(await lastAudit(audits)).toMatchObject({
        failure: "response-too-large",
        capHit: "bytes",
      });
    } finally {
      await stop(server);
    }
  });
});

describe("a body that ends, through the real listener", () => {
  it("passes a body of undeclared length on whole, with no length of its own", async () => {
    const { base, server, audits } = await relay(50 * 1024 * 1024);
    try {
      const result = await read(base, "/chunked");
      expect(result).toEqual({ status: 200, contentLength: null, body: "a,b\n1,2\n" });
      expect(await lastAudit(audits)).toMatchObject({ failure: undefined, bytes: 8 });
    } finally {
      await stop(server);
    }
  });

  it("keeps a declared Content-Length", async () => {
    const { base, server } = await relay(50 * 1024 * 1024);
    try {
      expect(await read(base, "/declared")).toEqual({
        status: 200,
        contentLength: "5",
        body: "whole",
      });
    } finally {
      await stop(server);
    }
  });
});
