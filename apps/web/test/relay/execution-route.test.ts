// @vitest-environment node
/**
 * The session's `execution` records say which route the execute took (W13).
 *
 * Through the relay, the routed fetch rebuilds a `Response` carrying the
 * `Location` and `Preference-Applied` the relay read, so the core's record is
 * field for field what a server exposing both headers to a page would give.
 * Without the route on it, every asynchronous pygeoapi run from a browser —
 * possible only through the relay — read as evidence against finding 0039.
 *
 * Driven through `createJobSession`, which composes the core client, the
 * routed fetch and the observation sink, with the relay and the OGC server
 * both answered by one stubbed global `fetch`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionObservation, WebObservation } from "../../src/observations.js";
import type { RelayEndpoint } from "../../src/relay/contract.js";
import { createJobSession, type JobSession } from "../../src/relay/job-session.js";

const RELAY = "http://relay.test";
const BASE = "http://ogc.test";

const VIA_RELAY: RelayEndpoint = {
  key: "via-relay",
  baseUrl: BASE,
  executeRoute: "relay",
  readRoute: "relay",
  callbacks: false,
};
const DIRECT: RelayEndpoint = {
  ...VIA_RELAY,
  key: "direct",
  executeRoute: "direct",
  readRoute: "direct",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** The relay's own answers carry its marker. */
const fromRelay = (response: Response): Response => {
  response.headers.set("X-Relay", "1");
  return response;
};

/**
 * The relay and the OGC server. The server sends no CORS headers, so a direct
 * execute fails as a page sees it: no response at all.
 */
function stubNetwork(options: { readonly directExecute: "created" | "cors-blocked" }) {
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const prefer = new Headers(init?.headers).get("Prefer") ?? "";

    if (url.origin === RELAY) {
      if (url.pathname === "/sessions") {
        return Promise.resolve(
          fromRelay(json({ token: "session-1", expiresAt: Date.now() + 60_000 }, 201)),
        );
      }
      if (url.pathname === "/sessions/events") {
        // Opens, then stays open until the session is disposed.
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("event: ready\ndata: {}\n\n"));
          },
        });
        return Promise.resolve(
          fromRelay(new Response(body, { headers: { "Content-Type": "text/event-stream" } })),
        );
      }
      if (url.pathname.startsWith("/execute/") && /respond-async/.test(prefer)) {
        return Promise.resolve(
          fromRelay(
            json({
              upstream: {
                status: 201,
                location: `${BASE}/jobs/42`,
                contentType: "application/json",
                preferenceApplied: "respond-async",
                body: "null",
              },
              registration: null,
            }),
          ),
        );
      }
      if (url.pathname.startsWith("/execute/")) {
        // A synchronous execute for a read-route endpoint: the result, raw.
        const raw = fromRelay(
          json({ id: "result", value: 1 }, 200, { "Preference-Applied": "wait" }),
        );
        raw.headers.set("X-Relay-Raw", "1");
        return Promise.resolve(raw);
      }
      if (url.pathname.startsWith("/read/")) {
        return Promise.resolve(fromRelay(json({ links: [] })));
      }
      return Promise.resolve(fromRelay(json({ title: "Not Found" }, 404)));
    }

    if (method === "POST") {
      if (options.directExecute === "cors-blocked") {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(
        json(null, 201, { Location: `${BASE}/jobs/7`, "Preference-Applied": "respond-async" }),
      );
    }
    if (url.pathname.startsWith("/jobs/")) {
      return Promise.resolve(
        json({ jobID: url.pathname.split("/").pop(), status: "accepted", type: "process" }),
      );
    }
    return Promise.resolve(json({ links: [] }));
  });
}

let session: JobSession | undefined;

afterEach(() => {
  session?.dispose();
  session = undefined;
  vi.unstubAllGlobals();
});

function observed(of: JobSession): WebObservation[] {
  let observations: WebObservation[] = [];
  of.subscribe((snapshot) => {
    observations = snapshot.observations.map((entry) => entry.observation);
  })();
  return observations;
}

function executionRecords(of: JobSession): ExecutionObservation[] {
  return observed(of).filter(
    (observation): observation is ExecutionObservation => observation.kind === "execution",
  );
}

describe("the route on a session's execution records (W13, finding 0039)", () => {
  it("tags an asynchronous run the relay named as relay, though the core read Location", async () => {
    stubNetwork({ directExecute: "created" });
    session = createJobSession(RELAY);

    const execution = await session.run(VIA_RELAY, "slow", { seconds: 1 }, {});

    expect(execution.kind).toBe("job");
    const [record] = executionRecords(session);
    // The core's own fields describe what the relay read …
    expect(record).toMatchObject({ locationPresent: true, preferenceAppliedHeader: true });
    // … and the tag says so.
    expect(record?.executeRoute).toBe("relay");
  });

  it("tags an asynchronous run on a direct endpoint as direct", async () => {
    stubNetwork({ directExecute: "created" });
    session = createJobSession(RELAY);

    await session.run(DIRECT, "slow", { seconds: 1 }, {});

    expect(executionRecords(session)).toMatchObject([
      { executeRoute: "direct", locationPresent: true },
    ]);
  });

  it("tags a direct execute that got no answer as direct — the route reports nothing for it", async () => {
    stubNetwork({ directExecute: "cors-blocked" });
    session = createJobSession(RELAY);

    await expect(session.run(DIRECT, "slow", { seconds: 1 }, {})).rejects.toThrow();

    expect(executionRecords(session)).toMatchObject([
      { outcome: "transport-failure", executeRoute: "direct" },
    ]);
    expect(observed(session).some((observation) => observation.kind === "execute-route")).toBe(
      false,
    );
  });

  it("tags a synchronous execute by the route the endpoint's reads take", async () => {
    stubNetwork({ directExecute: "created" });
    session = createJobSession(RELAY);

    // Read through the relay: a synchronous execute goes to the relay raw.
    await session.client(VIA_RELAY, "relay").execute("echo", { inputs: {}, mode: "sync" });
    // Read directly: the same endpoint's synchronous execute goes direct.
    await session.client(VIA_RELAY, "direct").execute("echo", { inputs: {}, mode: "sync" });

    expect(executionRecords(session).map((record) => record.executeRoute)).toEqual([
      "relay",
      "direct",
    ]);
  });

  it("does not carry one execute's route over to the next on the same client", async () => {
    stubNetwork({ directExecute: "cors-blocked" });
    session = createJobSession(RELAY);
    const client = session.client(VIA_RELAY, "direct");

    // Asynchronous: the relay route. Synchronous: direct, and no answer.
    await client.execute("slow", { inputs: {}, mode: "async" });
    await expect(client.execute("echo", { inputs: {}, mode: "sync" })).rejects.toThrow();

    expect(executionRecords(session)).toMatchObject([
      { requestedMode: "async", executeRoute: "relay" },
      { requestedMode: "sync", outcome: "transport-failure", executeRoute: "direct" },
    ]);
  });
});
