// @vitest-environment node
/**
 * The page's jobs across a reload: a new run is stored as four fields, a
 * stored job is polled again after a reload, and "Remove from list" and
 * "Dismiss" do what their labels say and nothing more.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobStore, StoredJob } from "../../src/jobs/job-store.js";
import type { RelayEndpoint } from "../../src/relay/contract.js";
import { createJobSession, type JobSession } from "../../src/relay/job-session.js";

const BASE = "http://ogc.test";
const ENDPOINT: RelayEndpoint = {
  key: "typed",
  baseUrl: BASE,
  executeRoute: "direct",
  readRoute: "direct",
  callbacks: false,
};
const STORED: StoredJob = {
  endpoint: BASE,
  statusUrl: `${BASE}/jobs/1`,
  processId: "slow",
  startedAt: "2026-09-30T08:00:00.000Z",
};

function jobDocument(id: string, status: string): Response {
  return new Response(JSON.stringify({ jobID: id, status, type: "process" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A server: `POST …/execution` makes job 9, every job reads `accepted`, `DELETE` dismisses. */
function server() {
  const calls: { method: string; url: string }[] = [];
  const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ jobID: "9", status: "accepted", type: "process" }), {
          status: 201,
          headers: { "Content-Type": "application/json", Location: `${BASE}/jobs/9` },
        }),
      );
    }
    const id = url.split("/").pop() ?? "";
    return Promise.resolve(jobDocument(id, method === "DELETE" ? "dismissed" : "accepted"));
  });
  vi.stubGlobal("fetch", fetchImpl);
  return calls;
}

function memoryStore(initial: StoredJob[] = []): JobStore & { saved: unknown[][] } {
  let jobs = initial;
  const saved: unknown[][] = [];
  return {
    saved,
    load: () => jobs,
    save: (next) => {
      jobs = [...next];
      saved.push(JSON.parse(JSON.stringify(next)) as unknown[]);
    },
    // One tab's store: no other tab changes it. See jobs-across-tabs.test.ts.
    subscribe: () => () => undefined,
  };
}

let session: JobSession | undefined;

afterEach(() => {
  session?.dispose();
  session = undefined;
  vi.unstubAllGlobals();
});

describe("the jobs this browser started", () => {
  it("polls a stored job again after a reload, with no doorbell", async () => {
    const calls = server();
    session = createJobSession(undefined, { store: memoryStore([STORED]) });
    let rows: readonly unknown[] = [];
    session.subscribe((snapshot) => {
      rows = snapshot.jobs;
    });
    await vi.waitFor(() => {
      expect(rows).toEqual([
        expect.objectContaining({
          statusUrl: STORED.statusUrl,
          endpoint: BASE,
          processId: "slow",
          startedAt: STORED.startedAt,
          restored: true,
          ref: undefined,
          status: expect.objectContaining({ status: "accepted" }) as unknown,
        }),
      ]);
    });
    expect(calls).toContainEqual({ method: "GET", url: STORED.statusUrl });
  });

  it("stores a new run as its endpoint, status URL, process and start time — nothing else", async () => {
    server();
    const store = memoryStore();
    session = createJobSession(undefined, {
      store,
      now: () => new Date("2026-09-30T12:00:00.000Z"),
    });
    await session.run(ENDPOINT, "slow", { seconds: 3, secret: "an input value" }, {});
    expect(store.saved.at(-1)).toEqual([
      {
        endpoint: BASE,
        statusUrl: `${BASE}/jobs/9`,
        processId: "slow",
        startedAt: "2026-09-30T12:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(store.saved)).not.toContain("an input value");
  });

  it("removes a job from the list and from storage, and tells the server nothing", async () => {
    const calls = server();
    const store = memoryStore([STORED]);
    session = createJobSession(undefined, { store });
    let count = -1;
    session.subscribe((snapshot) => {
      count = snapshot.jobs.length;
    });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    session.remove(STORED.statusUrl);
    expect(count).toBe(0);
    expect(store.saved.at(-1)).toEqual([]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("dismisses a job with DELETE on its status URL, then reads it again", async () => {
    const calls = server();
    session = createJobSession(undefined, { store: memoryStore([STORED]) });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const dismissal = await session.dismiss(STORED.statusUrl);
    expect(dismissal.kind).toBe("dismissed");
    expect(calls).toContainEqual({ method: "DELETE", url: STORED.statusUrl });
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
    });
  });

  it("touches no storage without a store: the developer panel's jobs stay its own", async () => {
    server();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("window", { localStorage: storage });
    session = createJobSession(undefined);
    const execution = await session.run(ENDPOINT, "slow", {}, {});
    expect(execution.kind).toBe("job");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
