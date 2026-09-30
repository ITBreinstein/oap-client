/**
 * The jobs this browser started, kept across a reload so they can be polled
 * again: in `localStorage`, and only what polling again needs.
 *
 * A stored job is four strings — the endpoint, the job's status URL, the
 * process and when it started. Never an input value, a result, a relay
 * session token or a callback token: storage outlives the page and is
 * readable by any script on this origin, and none of those is needed to read
 * a job's status. So after a reload a job has no doorbell; it is polled.
 *
 * Storage may be missing, full, or refused — a private window, a blocked
 * site, a sandboxed frame — and even *reading* `window.localStorage` can
 * throw. Every access is in a try/catch, and the page works without it: the
 * list simply does not survive a reload.
 *
 * What comes back out is checked entry by entry, never asserted into shape:
 * another tab, an older version of this page or a person with the dev tools
 * may have written it.
 */

import { isAbsoluteUrl } from "@breinstein/oap-client";

export interface StoredJob {
  /** The endpoint's base URL: what the job's observations are recorded against. */
  readonly endpoint: string;
  readonly statusUrl: string;
  readonly processId: string;
  /** ISO 8601, this browser's clock. */
  readonly startedAt: string;
}

export interface JobStore {
  /** Every stored job, oldest first; empty when storage is unavailable. */
  load(): StoredJob[];
  /** Replace what is stored. Silently does nothing when storage is unavailable. */
  save(jobs: readonly StoredJob[]): void;
}

/** Versioned, so a later shape can be told apart instead of misread. */
export const STORAGE_KEY = "oap-client.jobs.v1";

/** Enough for a working session; the oldest go first beyond it. */
export const MAX_STORED_JOBS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  if (!isAbsoluteUrl(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** One stored entry, or undefined when it is not one. */
export function readStoredJob(value: unknown): StoredJob | undefined {
  if (!isRecord(value)) return undefined;
  const { endpoint, statusUrl, processId, startedAt } = value;
  if (
    typeof endpoint !== "string" ||
    typeof statusUrl !== "string" ||
    typeof processId !== "string" ||
    typeof startedAt !== "string" ||
    !isHttpUrl(endpoint) ||
    !isHttpUrl(statusUrl) ||
    processId === "" ||
    Number.isNaN(Date.parse(startedAt))
  ) {
    return undefined;
  }
  // Rebuilt from the four fields, so nothing else stored alongside survives.
  return { endpoint, statusUrl, processId, startedAt };
}

/** `window.localStorage`, or undefined where reading it throws or there is none. */
function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function createJobStore(storage: () => Storage | undefined = browserStorage): JobStore {
  return {
    load() {
      let text: string | null;
      try {
        text = storage()?.getItem(STORAGE_KEY) ?? null;
      } catch {
        return [];
      }
      if (text === null) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      const jobs: StoredJob[] = [];
      const seen = new Set<string>();
      for (const entry of parsed) {
        const job = readStoredJob(entry);
        if (job === undefined || seen.has(job.statusUrl)) continue;
        seen.add(job.statusUrl);
        jobs.push(job);
      }
      return jobs.slice(-MAX_STORED_JOBS);
    },

    save(jobs) {
      // Only the four fields, whatever the caller's objects carry.
      const kept = jobs
        .slice(-MAX_STORED_JOBS)
        .map(({ endpoint, statusUrl, processId, startedAt }) => ({
          endpoint,
          statusUrl,
          processId,
          startedAt,
        }));
      try {
        const target = storage();
        if (kept.length === 0) target?.removeItem(STORAGE_KEY);
        else target?.setItem(STORAGE_KEY, JSON.stringify(kept));
      } catch {
        // Full, refused or gone: the list lasts as long as the page.
      }
    },
  };
}

/** A store that keeps nothing: for a session that must not persist, and for tests. */
export const NO_STORE: JobStore = { load: () => [], save: () => undefined };
