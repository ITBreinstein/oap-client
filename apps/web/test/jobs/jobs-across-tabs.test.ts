/**
 * "My jobs" with the page open in more than one tab (review W12). The list is
 * one origin's localStorage, shared by every tab: a tab that saves keeps the
 * other tabs' jobs, and hears when another tab adds or removes one.
 *
 * Each "tab" here is a job session on one shared storage, with its own event
 * target standing in for its window; the test plays the browser, which fires
 * `storage` in every other tab of the origin after a write.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createJobStore, STORAGE_KEY } from "../../src/jobs/job-store.js";
import type { RelayEndpoint } from "../../src/relay/contract.js";
import { createJobSession, type JobSession } from "../../src/relay/job-session.js";

const ENDPOINT: RelayEndpoint = {
  key: "typed",
  baseUrl: "https://ogc.example",
  executeRoute: "direct",
  readRoute: "direct",
  callbacks: false,
};
const job = (name: string) => `https://ogc.example/jobs/${name}`;

/** One origin's localStorage. `refuse` makes one tab's writes fail, as a full quota does. */
function sharedStorage() {
  const items = new Map<string, string>();
  const view = (refuse: () => boolean): Storage => ({
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      if (refuse()) throw new DOMException("quota", "QuotaExceededError");
      items.set(key, value);
    },
  });
  return {
    view,
    stored: () =>
      (JSON.parse(items.get(STORAGE_KEY) ?? "[]") as { statusUrl: string }[])
        .map((entry) => entry.statusUrl)
        .sort(),
  };
}

const sessions: JobSession[] = [];

function openTabs(count: number, refuseFor?: number) {
  const storage = sharedStorage();
  const windows = Array.from({ length: count }, () => new EventTarget());
  const tabs = windows.map((events, index) => {
    const tab = createJobSession(undefined, {
      store: createJobStore(
        () => storage.view(() => index === refuseFor),
        () => events,
      ),
    });
    sessions.push(tab);
    return tab;
  });
  /** What the browser does after tab `from` wrote: tell every other tab. */
  const announce = (from: number) => {
    windows.forEach((events, index) => {
      if (index === from) return;
      const event = new Event("storage");
      Object.defineProperty(event, "key", { value: STORAGE_KEY });
      events.dispatchEvent(event);
    });
  };
  const listed = (tab: JobSession) => {
    let jobs: string[] = [];
    tab.subscribe((snapshot) => {
      jobs = snapshot.jobs.map((row) => row.statusUrl).sort();
    })();
    return jobs;
  };
  return { storage, tabs, announce, listed };
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllGlobals();
});

function answerAccepted() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({ jobID: "x", status: "accepted", type: "process" }, { status: 200 }),
      ),
    ),
  );
}

describe("jobs across tabs", () => {
  it("keeps the first tab's job in storage when the second tab starts one", () => {
    answerAccepted();
    const { storage, tabs } = openTabs(2);
    tabs[0]?.track(ENDPOINT, job("from-tab-1"), "direct", "slow");
    tabs[1]?.track(ENDPOINT, job("from-tab-2"), "direct", "slow");
    expect(storage.stored()).toEqual([job("from-tab-1"), job("from-tab-2")]);
  });

  it("keeps the other tab's job when this tab removes its own", () => {
    answerAccepted();
    const { storage, tabs } = openTabs(2);
    tabs[0]?.track(ENDPOINT, job("from-tab-1"), "direct", "slow");
    tabs[1]?.track(ENDPOINT, job("from-tab-2"), "direct", "slow");
    tabs[1]?.remove(job("from-tab-2"));
    expect(storage.stored()).toEqual([job("from-tab-1")]);
  });

  it("lists another tab's new job once the browser says storage changed", () => {
    answerAccepted();
    const { tabs, announce, listed } = openTabs(2);
    const [first, second] = tabs;
    if (first === undefined || second === undefined) throw new Error("two tabs");
    second.track(ENDPOINT, job("from-tab-2"), "direct", "slow");
    expect(listed(first)).toEqual([]);
    announce(1);
    expect(listed(first)).toEqual([job("from-tab-2")]);
  });

  it("takes a job another tab removed off this tab's list too", () => {
    answerAccepted();
    const { storage, tabs, announce, listed } = openTabs(2);
    const [first, second] = tabs;
    if (first === undefined || second === undefined) throw new Error("two tabs");
    first.track(ENDPOINT, job("shared"), "direct", "slow");
    announce(0);
    expect(listed(second)).toEqual([job("shared")]);

    second.remove(job("shared"));
    announce(1);
    expect(listed(first)).toEqual([]);
    expect(storage.stored()).toEqual([]);
  });

  it("does not take a job for removed elsewhere when its own save never reached storage", () => {
    answerAccepted();
    const { tabs, announce, listed } = openTabs(2, 0);
    const [first, second] = tabs;
    if (first === undefined || second === undefined) throw new Error("two tabs");
    first.track(ENDPOINT, job("kept-in-memory"), "direct", "slow"); // quota: not saved
    second.track(ENDPOINT, job("from-tab-2"), "direct", "slow");
    announce(1);
    expect(listed(first)).toEqual([job("from-tab-2"), job("kept-in-memory")]);
  });

  it("stops listening when the session is disposed", () => {
    answerAccepted();
    const { tabs, announce, listed } = openTabs(2);
    const [first, second] = tabs;
    if (first === undefined || second === undefined) throw new Error("two tabs");
    first.dispose();
    second.track(ENDPOINT, job("from-tab-2"), "direct", "slow");
    announce(1);
    expect(listed(first)).toEqual([]);
  });
});
