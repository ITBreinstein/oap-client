/**
 * The relay against the pinned pygeoapi, with real callbacks.
 *
 * The relay runs in this process and listens on every interface; pygeoapi, in
 * its container, calls it back as `host.docker.internal` (mapped for Linux in
 * infra/compose/pygeoapi.yml). Nothing here is mocked. That is the point: the
 * unit lane proves the relay's logic, and this lane proves pygeoapi actually
 * rings it.
 *
 * Three claims:
 *
 * 1. An asynchronous job started through the relay is named at once and
 *    rings its doorbell, and polling the server confirms what the doorbell
 *    only hinted at.
 * 2. A relay restart in the middle of a job leaves the job **on the server**
 *    `successful`. The browser side of this — reconnect, reconcile — is in
 *    apps/web's unit tests; what only a live server can show is that the
 *    restart did not damage the job itself (finding 0047).
 * 3. Finding 0047 still holds: a callback pygeoapi cannot deliver still turns
 *    a successful job into `failed`. If this goes red, pygeoapi fixed it —
 *    re-read the finding and the relay's "always answer" rule.
 */

import { once } from "node:events";
import { createServer } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp, type RelayEvent } from "../../src/app.js";
import { parseConfig } from "../../src/config.js";

const PYGEOAPI = "http://localhost:5080";
const CALLBACK_HOST = "host.docker.internal";

let pygeoapiUp = false;
beforeAll(async () => {
  try {
    const response = await fetch(`${PYGEOAPI}/processes/slow?f=json`, {
      signal: AbortSignal.timeout(3_000),
    });
    pygeoapiUp = response.ok;
  } catch {
    pygeoapiUp = false;
  }
});

/** A port nothing is listening on, found by listening on it and closing. */
async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0);
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  await once(probe, "close");
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

interface RunningRelay {
  readonly base: string;
  readonly events: RelayEvent[];
  stop(): Promise<void>;
}

const running: RunningRelay[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((relay) => relay.stop()));
});

async function startRelay(port: number): Promise<RunningRelay> {
  const config = parseConfig({
    publicUrl: `http://${CALLBACK_HOST}:${String(port)}`,
    endpoints: [
      {
        key: "pygeoapi",
        baseUrl: PYGEOAPI,
        executeRoute: "relay",
        callbacks: true,
        allowPrivateNetwork: true,
      },
    ],
  });
  const events: RelayEvent[] = [];
  const server: ServerType = serve({
    fetch: createApp({ config, onEvent: (event) => events.push(event) }).fetch,
    port,
  });
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("relay has no port");
  const relay: RunningRelay = {
    base: `http://localhost:${String(address.port)}`,
    events,
    stop: async () => {
      if ("closeAllConnections" in server) server.closeAllConnections();
      server.close();
      await once(server, "close").catch(() => undefined);
    },
  };
  running.push(relay);
  return relay;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function openSession(relay: RunningRelay): Promise<string> {
  const body: unknown = await (await fetch(`${relay.base}/sessions`, { method: "POST" })).json();
  if (!isRecord(body) || typeof body["token"] !== "string") throw new Error("no session");
  return body["token"];
}

/** The doorbell stream, as a queue of refs. */
async function openDoorbells(relay: RunningRelay, token: string, signal: AbortSignal) {
  const response = await fetch(`${relay.base}/sessions/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const body = response.body;
  if (!response.ok || body === null) throw new Error(`stream ${String(response.status)}`);
  const refs: string[] = [];
  const waiters: (() => void)[] = [];
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of body) {
        const bytes: unknown = chunk;
        if (!(bytes instanceof Uint8Array)) throw new Error("stream sent a non-byte chunk");
        buffer += decoder.decode(bytes, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (block.includes("event: job") && data !== undefined) {
            const parsed: unknown = JSON.parse(data);
            if (isRecord(parsed) && typeof parsed["ref"] === "string") refs.push(parsed["ref"]);
            waiters.splice(0).forEach((wake) => {
              wake();
            });
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Aborted at the end of the test, or the relay went away.
    }
  })();
  return {
    refs,
    /** Resolves once `count` doorbells have rung, or rejects after `ms`. */
    async until(count: number, ms: number): Promise<void> {
      const deadline = Date.now() + ms;
      while (refs.length < count) {
        const left = deadline - Date.now();
        if (left <= 0)
          throw new Error(`only ${String(refs.length)} doorbell(s) after ${String(ms)} ms`);
        await Promise.race([
          new Promise<void>((resolve) => waiters.push(resolve)),
          new Promise<void>((resolve) => setTimeout(resolve, left)),
        ]);
      }
    },
  };
}

async function relayExecute(relay: RunningRelay, token: string, seconds: number) {
  const response = await fetch(`${relay.base}/execute/pygeoapi/slow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ inputs: { seconds } }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body["upstream"])) throw new Error("malformed execute answer");
  const location = body["upstream"]["location"];
  const registration = body["registration"];
  if (typeof location !== "string") throw new Error("no Location relayed");
  if (!isRecord(registration) || typeof registration["ref"] !== "string") {
    throw new Error("no registration");
  }
  return { location, ref: registration["ref"], status: body["upstream"]["status"] };
}

/** The job's status as pygeoapi itself reports it — the authority. */
async function serverStatus(jobUrl: string): Promise<string> {
  const body: unknown = await (await fetch(`${jobUrl}?f=json`)).json();
  if (!isRecord(body) || typeof body["status"] !== "string") throw new Error("no status");
  return body["status"];
}

/**
 * Poll until the server reports `wanted`, or give up after `ms` and return
 * the last status seen.
 *
 * Not "until terminal": on pygeoapi a terminal status is not final. When the
 * success callback fails, the job reads `successful` for as long as the failed
 * delivery takes and is then rewritten to `failed` (finding 0047). A test that
 * stopped at the first terminal status would pass on the transient one.
 */
async function waitForStatus(jobUrl: string, wanted: string, ms: number): Promise<string[]> {
  const deadline = Date.now() + ms;
  const seen: string[] = [];
  for (;;) {
    const status = await serverStatus(jobUrl);
    if (seen.at(-1) !== status) seen.push(status);
    if (status === wanted || Date.now() > deadline) return seen;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe("callbacks through the relay, against pygeoapi", () => {
  it("names the job at once, rings for in-progress and success, and the poll confirms it", async (context) => {
    if (!pygeoapiUp) context.skip();
    const relay = await startRelay(await freePort());
    const token = await openSession(relay);
    const stream = new AbortController();
    const doorbells = await openDoorbells(relay, token, stream.signal);

    const job = await relayExecute(relay, token, 3);

    expect(job.status).toBe(201);
    expect(job.location).toMatch(/^http:\/\/localhost:5080\/jobs\/[0-9a-f-]{36}$/);
    await doorbells.until(2, 20_000);
    expect(new Set(doorbells.refs)).toEqual(new Set([job.ref]));
    // The success doorbell rang after the relay answered the callback, so the
    // status read here is past pygeoapi's rewrite window (finding 0047).
    expect(await serverStatus(job.location)).toBe("successful");

    const callbacks = relay.events.filter((event) => event.kind === "callback");
    expect(callbacks).toEqual([
      { kind: "callback", callbackKind: "in-progress", outcome: "delivered" },
      { kind: "callback", callbackKind: "success", outcome: "delivered" },
    ]);
    stream.abort();
  }, 30_000);

  it("survives a relay restart mid-job: the job stays successful on the server", async (context) => {
    if (!pygeoapiUp) context.skip();
    const port = await freePort();
    const first = await startRelay(port);
    const token = await openSession(first);
    const stream = new AbortController();
    const doorbells = await openDoorbells(first, token, stream.signal);

    const job = await relayExecute(first, token, 6);
    await doorbells.until(1, 10_000);

    // Restart: the old relay and its state are gone, and a new one is on the
    // same port well before the job's success callback is due.
    stream.abort();
    await first.stop();
    const second = await startRelay(port);

    expect((await waitForStatus(job.location, "successful", 20_000)).at(-1)).toBe("successful");
    // pygeoapi calls back after writing `successful`, and a failed delivery
    // would rewrite it. So wait for the callback to have been answered — by a
    // relay that no longer knew the token: 404, not a refused connection —
    // and only then read the status that counts.
    await expect
      .poll(() => second.events, { timeout: 10_000, interval: 200 })
      .toContainEqual({ kind: "callback", callbackKind: "success", outcome: "unknown" });
    expect(await serverStatus(job.location)).toBe("successful");
  }, 40_000);
});

describe("finding 0047, pinned", () => {
  it("pygeoapi still turns a successful job into failed when successUri refuses the connection", async (context) => {
    if (!pygeoapiUp) context.skip();
    const closed = await freePort();
    const response = await fetch(`${PYGEOAPI}/processes/slow/execution`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "respond-async" },
      body: JSON.stringify({
        inputs: { seconds: 1 },
        subscriber: { successUri: `http://${CALLBACK_HOST}:${String(closed)}/nobody-home` },
      }),
    });
    const location = response.headers.get("location");
    if (location === null) throw new Error("no Location");

    const seen = await waitForStatus(location, "failed", 15_000);
    expect(seen.at(-1)).toBe("failed");
    // Whether the transient `successful` was caught depends on timing: the
    // window is as long as the failed delivery took. Recorded, not asserted.
    console.info(`0047 pin: status sequence ${seen.join(" -> ")}`);
  }, 20_000);
});
