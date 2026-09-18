/**
 * `listJobs()` — the paginated walk, and the link relations it depends on.
 *
 * The walk's stopping conditions are `list-processes.ts`'s, so the tests are
 * that file's too. What is new here is the entry-level tolerance: one
 * unreadable job must not cost the caller the rest of the page, because this
 * list is the browser's only honest recovery when it cannot name its own job
 * (T8), and a list that refuses to render is no recovery at all.
 */

import { describe, expect, it } from "vitest";
import { listJobs } from "../../src/jobs/list-jobs.js";
import { findLink } from "../../src/links/find.js";
import { MalformedJobDocumentError } from "../../src/errors.js";
import { AbortError } from "../../src/http/errors.js";
import type { Link } from "../../src/links/types.js";
import type { Observation } from "../../src/observations.js";

const JOBS_URL = "https://service.test/oapi/jobs";

function collect(): { sink: (o: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (o) => seen.push(o), seen };
}

function job(id: string, status = "successful"): Record<string, unknown> {
  return { type: "process", jobID: id, processID: "slow", status };
}

/** A fake `fetch` that serves a fixed map of URL to body, recording the order. */
function pages(map: Record<string, unknown>): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetch: (url: string) => {
      calls.push(url);
      const body = map[url];
      if (body === undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "no such page" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  };
}

describe("the relations this layer added — T6", () => {
  it("matches the results relation in both spellings", () => {
    const short: Link = { href: "https://service.test/a", rel: "results" };
    const long: Link = {
      href: "https://service.test/b",
      rel: "http://www.opengis.net/def/rel/ogc/1.0/results",
    };

    // Only the long form appears on either reference server; the short one is
    // carried for the same reason the short `execute` is.
    expect(findLink([short], "results")?.href).toBe("https://service.test/a");
    expect(findLink([long], "results")?.href).toBe("https://service.test/b");
  });

  it("matches the job-list relation in both spellings", () => {
    const short: Link = { href: "https://service.test/a", rel: "job-list" };
    const long: Link = {
      href: "https://service.test/b",
      rel: "http://www.opengis.net/def/rel/ogc/1.0/job-list",
    };

    expect(findLink([short], "jobList")?.href).toBe("https://service.test/a");
    // Both reference servers write exactly this, and only this.
    expect(findLink([long], "jobList")?.href).toBe("https://service.test/b");
  });
});

describe("the walk", () => {
  it("returns a single page when the server advertises no next", async () => {
    // pygeoapi's unpaginated default shape.
    const fake = pages({
      [JOBS_URL]: { jobs: [job("a"), job("b")], links: [{ rel: "self", href: JOBS_URL }] },
    });

    const list = await listJobs(JOBS_URL, { fetch: fake.fetch });

    expect(list.jobs.map((entry) => entry.jobId)).toEqual(["a", "b"]);
    expect(list.pageCount).toBe(1);
    expect(list.truncated).toBe(false);
  });

  it("follows next to the end", async () => {
    // ZOO's real paging shape: `next` carries `skip=`, not `offset=` — which is
    // exactly why the walk follows the advertised link instead of building one.
    const page2 = `${JOBS_URL}?limit=2&skip=2`;
    const fake = pages({
      [`${JOBS_URL}?limit=2`]: {
        jobs: [job("a"), job("b")],
        links: [{ rel: "next", href: page2 }],
        numberTotal: 3,
      },
      [page2]: { jobs: [job("c")], links: [] },
    });

    const list = await listJobs(JOBS_URL, { fetch: fake.fetch, limit: 2 });

    expect(list.jobs.map((entry) => entry.jobId)).toEqual(["a", "b", "c"]);
    expect(list.pageCount).toBe(2);
    expect(list.numberTotal).toBe(3);
    expect(list.truncated).toBe(false);
  });

  it("stops on a cycle and says so", async () => {
    // A server pointing `next` at itself is a real bug in the wild, and an
    // unguarded loop hangs the browser tab.
    const fake = pages({
      [JOBS_URL]: { jobs: [job("a")], links: [{ rel: "next", href: JOBS_URL }] },
    });

    const list = await listJobs(JOBS_URL, { fetch: fake.fetch });

    expect(list.truncated).toBe(true);
    expect(list.truncationReason).toBe("cycle");
    expect(fake.calls).toHaveLength(1);
  });

  it("stops at the page cap and says so", async () => {
    const one = `${JOBS_URL}?p=1`;
    const two = `${JOBS_URL}?p=2`;
    const three = `${JOBS_URL}?p=3`;
    const fake = pages({
      [JOBS_URL]: { jobs: [job("a")], links: [{ rel: "next", href: one }] },
      [one]: { jobs: [job("b")], links: [{ rel: "next", href: two }] },
      [two]: { jobs: [job("c")], links: [{ rel: "next", href: three }] },
    });

    const list = await listJobs(JOBS_URL, { fetch: fake.fetch, maxPages: 2 });

    expect(list.truncated).toBe(true);
    expect(list.truncationReason).toBe("page-cap");
    expect(list.pageCount).toBe(2);
  });

  it("deduplicates an id repeated across pages, keeping the first", async () => {
    const page2 = `${JOBS_URL}?p=2`;
    const fake = pages({
      [JOBS_URL]: { jobs: [job("a", "successful")], links: [{ rel: "next", href: page2 }] },
      [page2]: { jobs: [job("a", "failed"), job("b")], links: [] },
    });

    const list = await listJobs(JOBS_URL, { fetch: fake.fetch });

    expect(list.jobs.map((entry) => entry.jobId)).toEqual(["a", "b"]);
    expect(list.jobs[0]?.status).toBe("successful");
  });

  it("checks the abort signal between pages, not only at the start", async () => {
    const controller = new AbortController();
    const page2 = `${JOBS_URL}?p=2`;
    const fake = {
      calls: [] as string[],
      fetch: (url: string) => {
        fake.calls.push(url);
        controller.abort();
        return Promise.resolve(
          new Response(
            JSON.stringify({ jobs: [job("a")], links: [{ rel: "next", href: page2 }] }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      },
    };

    await expect(
      listJobs(JOBS_URL, { fetch: fake.fetch, signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("tolerance", () => {
  it("skips an unreadable entry and counts it, rather than losing the page", async () => {
    const fake = pages({
      [JOBS_URL]: { jobs: [job("a"), { jobID: "b" }, job("c")], links: [] },
    });
    const { sink, seen } = collect();

    const list = await listJobs(JOBS_URL, { fetch: fake.fetch, onObservation: sink });

    // The entry with no `status` is dropped; the other two survive.
    expect(list.jobs.map((entry) => entry.jobId)).toEqual(["a", "c"]);
    expect(seen.find((entry) => entry.kind === "job-list")).toMatchObject({
      jobCount: 2,
      unparseableCount: 1,
    });
  });

  it("is fatal when `jobs` is not an array", async () => {
    const fake = pages({ [JOBS_URL]: { jobs: "lots", links: [] } });

    await expect(listJobs(JOBS_URL, { fetch: fake.fetch })).rejects.toBeInstanceOf(
      MalformedJobDocumentError,
    );
  });

  it("is fatal when the page is not an object", async () => {
    const fake = pages({ [JOBS_URL]: [job("a")] });

    await expect(listJobs(JOBS_URL, { fetch: fake.fetch })).rejects.toBeInstanceOf(
      MalformedJobDocumentError,
    );
  });
});
