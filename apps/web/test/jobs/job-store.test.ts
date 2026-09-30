/**
 * The stored job list: four fields per job and nothing else, read back only
 * after checking, and never the reason the page fails when storage does.
 */

import { describe, expect, it } from "vitest";
import {
  createJobStore,
  MAX_STORED_JOBS,
  STORAGE_KEY,
  type StoredJob,
} from "../../src/jobs/job-store.js";

/** A Storage that keeps items in a Map, and can be told to throw. */
function memoryStorage(failing: "none" | "get" | "set" = "none"): Storage & {
  items: Map<string, string>;
} {
  const items = new Map<string, string>();
  return {
    items,
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => {
      if (failing === "get") throw new DOMException("denied", "SecurityError");
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (failing === "set") throw new DOMException("full", "QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

const JOB: StoredJob = {
  endpoint: "http://localhost:5080",
  statusUrl: "http://localhost:5080/jobs/1",
  processId: "slow",
  startedAt: "2026-09-30T10:00:00.000Z",
};

describe("the job store", () => {
  it("round-trips the four fields", () => {
    const storage = memoryStorage();
    const store = createJobStore(() => storage);
    store.save([JOB]);
    expect(createJobStore(() => storage).load()).toEqual([JOB]);
  });

  it("stores nothing but the four fields, whatever the caller's objects carry", () => {
    const storage = memoryStorage();
    const withMore = {
      ...JOB,
      inputs: { secret: "value" },
      results: { a: 1 },
      sessionToken: "s",
      ref: "r",
    };
    createJobStore(() => storage).save([withMore]);
    const stored: unknown = JSON.parse(storage.items.get(STORAGE_KEY) ?? "null");
    expect(stored).toEqual([JOB]);
  });

  it("reads back only well-formed entries, and drops fields it did not write", () => {
    const storage = memoryStorage();
    storage.items.set(
      STORAGE_KEY,
      JSON.stringify([
        { ...JOB, token: "leaked" },
        { ...JOB, statusUrl: "javascript:alert(1)" },
        { ...JOB, statusUrl: "http://localhost:5080/jobs/2", startedAt: "yesterday-ish" },
        { ...JOB, statusUrl: "http://localhost:5080/jobs/3", processId: 7 },
        "not a job",
        null,
        { ...JOB },
      ]),
    );
    expect(createJobStore(() => storage).load()).toEqual([JOB]);
  });

  it("answers empty for text that is not JSON, or JSON that is not a list", () => {
    for (const text of ["{", '{"jobs": []}', "null"]) {
      const storage = memoryStorage();
      storage.items.set(STORAGE_KEY, text);
      expect(createJobStore(() => storage).load()).toEqual([]);
    }
  });

  it("keeps the newest jobs beyond the cap", () => {
    const storage = memoryStorage();
    const many = Array.from({ length: MAX_STORED_JOBS + 5 }, (_, index) => ({
      ...JOB,
      statusUrl: `http://localhost:5080/jobs/${String(index)}`,
    }));
    createJobStore(() => storage).save(many);
    const loaded = createJobStore(() => storage).load();
    expect(loaded).toHaveLength(MAX_STORED_JOBS);
    expect(loaded[0]?.statusUrl).toBe("http://localhost:5080/jobs/5");
  });

  it("removes the key when the list is empty", () => {
    const storage = memoryStorage();
    const store = createJobStore(() => storage);
    store.save([JOB]);
    store.save([]);
    expect(storage.items.has(STORAGE_KEY)).toBe(false);
  });

  it("never throws when storage is missing, refuses reads, or is full", () => {
    const missing = createJobStore(() => undefined);
    expect(missing.load()).toEqual([]);
    expect(() => {
      missing.save([JOB]);
    }).not.toThrow();

    const throwing = createJobStore(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(throwing.load()).toEqual([]);
    expect(() => {
      throwing.save([JOB]);
    }).not.toThrow();

    expect(createJobStore(() => memoryStorage("get")).load()).toEqual([]);
    expect(() => {
      createJobStore(() => memoryStorage("set")).save([JOB]);
    }).not.toThrow();
  });
});
