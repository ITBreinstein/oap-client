// @vitest-environment node
/**
 * A job restored after a reload, on a server that sends no CORS headers
 * (review W9). Read direct it fails on every read, as a page sees it; once the
 * user confirms the relay for its endpoint, it is read, and dismissed, through
 * the relay's read route. Never through a stored token: none is stored.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobStore, StoredJob } from "../../src/jobs/job-store.js";
import type { RelayEndpoint } from "../../src/relay/contract.js";
import { createJobSession, type JobRow, type JobSession } from "../../src/relay/job-session.js";

const RELAY = "http://relay.test";
const BASE = "http://nocors.test";
const ENDPOINT: RelayEndpoint = {
  key: "nocors-relay",
  baseUrl: BASE,
  executeRoute: "relay",
  readRoute: "relay",
  callbacks: false,
};
const stored = (id: string): StoredJob => ({
  endpoint: BASE,
  statusUrl: `${BASE}/jobs/${id}`,
  processId: "slow",
  startedAt: "2026-10-07T08:00:00.000Z",
});

const json = (body: unknown, status = 200): Response => {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  response.headers.set("X-Relay", "1");
  return response;
};

/** The relay answers; the server, read direct, gives what a CORS block gives. */
function stubNetwork() {
  const relayed: string[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.origin !== RELAY) return Promise.reject(new TypeError("Failed to fetch"));
    if (url.pathname === "/sessions") {
      return Promise.resolve(json({ token: "session-1", expiresAt: Date.now() + 60_000 }, 201));
    }
    if (url.pathname === "/sessions/events") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: ready\ndata: {}\n\n"));
        },
      });
      return Promise.resolve(
        new Response(body, { headers: { "Content-Type": "text/event-stream", "X-Relay": "1" } }),
      );
    }
    if (url.pathname.startsWith("/read/nocors-relay/jobs/")) {
      relayed.push(`${method} ${url.pathname}`);
      const id = url.pathname.split("/").pop() ?? "";
      const answer = json({
        jobID: id,
        status: method === "DELETE" ? "dismissed" : "running",
        type: "process",
      });
      answer.headers.set("X-Relay-Raw", "1");
      return Promise.resolve(answer);
    }
    return Promise.resolve(json({ title: "Not Found" }, 404));
  });
  return relayed;
}

function memoryStore(initial: StoredJob[]): JobStore & { add: (job: StoredJob) => void } {
  let jobs = initial;
  const listeners = new Set<() => void>();
  return {
    load: () => jobs,
    save: (next) => {
      jobs = [...next];
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Another tab stores a job.
    add: (job) => {
      jobs = [...jobs, job];
      for (const listener of listeners) listener();
    },
  };
}

function rows(of: JobSession): readonly JobRow[] {
  let jobs: readonly JobRow[] = [];
  of.subscribe((snapshot) => {
    jobs = snapshot.jobs;
  })();
  return jobs;
}

let session: JobSession | undefined;

afterEach(() => {
  session?.dispose();
  session = undefined;
  vi.unstubAllGlobals();
});

describe("a restored job on a server a page cannot read (review W9)", () => {
  it("fails direct, then is read through the relay once the user confirms it", async () => {
    const relayed = stubNetwork();
    const created = createJobSession(RELAY, { store: memoryStore([stored("1")]) });
    session = created;

    // Direct first, as every connection is: the read fails, and says so.
    await vi.waitFor(() => {
      expect(rows(created)[0]?.lastError).toBeDefined();
    });
    expect(rows(created)[0]).toMatchObject({ route: "direct", status: undefined });
    expect(relayed).toEqual([]);

    // The user confirms the relay for this endpoint: the page asks for a
    // client that reads through it.
    created.client(ENDPOINT, "relay");
    await vi.waitFor(() => {
      expect(rows(created)[0]?.status?.status).toBe("running");
    });
    expect(rows(created)[0]).toMatchObject({ route: "relay", endpointKey: "nocors-relay" });
    expect(relayed).toContain("GET /read/nocors-relay/jobs/1");

    // And Dismiss reaches the server, through the same route.
    await created.dismiss(`${BASE}/jobs/1`);
    expect(relayed).toContain("DELETE /read/nocors-relay/jobs/1");
  });

  it("reads a job another tab stores afterwards through the relay at once", async () => {
    const relayed = stubNetwork();
    const store = memoryStore([]);
    const created = createJobSession(RELAY, { store });
    session = created;
    created.client(ENDPOINT, "relay");

    store.add(stored("2"));
    await vi.waitFor(() => {
      expect(rows(created)[0]?.status?.status).toBe("running");
    });
    expect(rows(created)[0]).toMatchObject({ route: "relay", restored: true });
    expect(relayed).toContain("GET /read/nocors-relay/jobs/2");
  });

  it("leaves a restored job on another endpoint alone", async () => {
    stubNetwork();
    const elsewhere: StoredJob = {
      ...stored("3"),
      endpoint: "http://other.test",
      statusUrl: "http://other.test/jobs/3",
    };
    const created = createJobSession(RELAY, { store: memoryStore([elsewhere]) });
    session = created;
    created.client(ENDPOINT, "relay");
    await vi.waitFor(() => {
      expect(rows(created)[0]?.lastError).toBeDefined();
    });
    expect(rows(created)[0]).toMatchObject({ route: "direct" });
  });
});
