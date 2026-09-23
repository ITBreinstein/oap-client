/**
 * What a *browser* can actually do with the job endpoints, cross-origin.
 *
 * This is the one thing no Node test can prove. Node ignores CORS entirely, so
 * every job operation in the contract and interop lanes passes against both
 * pygeoapi ports and against ZOO — and tells us nothing about whether
 * `apps/web` can offer the same buttons.
 *
 * Three questions, each with a different answer, and the differences are the
 * deliverable:
 *
 * 1. **Can a browser read a job's status?** A `GET` is a simple request, so it
 *    needs only `Access-Control-Allow-Origin`.
 * 2. **Can a browser dismiss a job?** `DELETE` is not a simple request, so the
 *    browser sends an `OPTIONS` preflight first and refuses to send the
 *    `DELETE` at all unless the preflight answers with
 *    `Access-Control-Allow-Methods`. This is a **new** CORS surface that Tasks
 *    1–4 never touched.
 * 3. **Can a browser find the job it just started?** `Location` is not
 *    CORS-safelisted, so it is invisible without
 *    `Access-Control-Expose-Headers` — findings 0002 and 0009, re-confirmed
 *    here on the job endpoints rather than assumed to carry over.
 *
 * The page under test is irrelevant; it is loaded only to obtain an origin to
 * make requests *from*. The finding is the deliverable, not the UI — `apps/web`
 * has no job panel yet.
 *
 * Skips itself when the servers are not up, exactly as the interop lane does: a
 * spec that goes red because Docker is stopped trains everyone to ignore it.
 */

import { expect, test, type Page } from "@playwright/test";

const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";

interface ProbeResult {
  readonly ok: boolean;
  /** The failure as the browser reported it — opaque by design for a CORS block. */
  readonly error?: string;
  readonly status?: number;
  /** Whether `Location` was readable from script. */
  readonly location?: string | null;
}

/** Is the server answering at all? Decided outside the browser. */
async function reachable(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/?f=json`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start a job from Node, so the browser test is about *reading and dismissing*
 * rather than about whether it could create one.
 */
async function startJob(base: string, seconds: number): Promise<string> {
  const response = await fetch(`${base}/processes/slow/execution`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "respond-async" },
    body: JSON.stringify({ inputs: { seconds }, outputs: {} }),
  });
  const location = response.headers.get("location");
  if (location === null) throw new Error("no Location on the async execute");
  return location;
}

/** Run `fetch` inside the page, and report what the browser allowed. */
async function probe(page: Page, url: string, method: string): Promise<ProbeResult> {
  return page.evaluate(
    async ([target, verb]: [string, string]): Promise<ProbeResult> => {
      try {
        const response = await fetch(target, { method: verb });
        return {
          ok: true,
          status: response.status,
          location: response.headers.get("location"),
        };
      } catch (error) {
        // A CORS block and a dead host are the same opaque TypeError by design;
        // the browser will not say which, which is the whole point of finding
        // 0002's framing.
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    [url, method] as [string, string],
  );
}

test.describe("job endpoints from a browser", () => {
  test.beforeEach(async ({ page }) => {
    // Any origin that is not the server's will do; the app's own page is the
    // one we know is served.
    await page.goto("/");
  });

  test("CORS port: a browser can read a job status", async ({ page }) => {
    test.skip(!(await reachable(CORS)), "pygeoapi :5080 is not answering");
    const jobUrl = await startJob(CORS, 30);

    const result = await probe(page, jobUrl, "GET");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  test("CORS port: a browser CAN dismiss — the DELETE preflight succeeds", async ({ page }) => {
    test.skip(!(await reachable(CORS)), "pygeoapi :5080 is not answering");
    const jobUrl = await startJob(CORS, 30);

    // The load-bearing assertion of this file. `DELETE` is not a simple
    // request, so this only reaches the server if `OPTIONS /jobs/{id}` answered
    // with `Access-Control-Allow-Methods` including DELETE. pygeoapi's
    // `cors: true` does answer it — verified 2026-09-16 — so dismissal *is*
    // reachable from a browser on this port.
    const result = await probe(page, jobUrl, "DELETE");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  test("CORS port: a browser still cannot read Location — findings 0002 and 0009", async ({
    page,
  }) => {
    test.skip(!(await reachable(CORS)), "pygeoapi :5080 is not answering");

    // The execute request itself, from the page, so the header question is
    // asked in the situation that actually matters.
    const result = await page.evaluate(async (base: string) => {
      const response = await fetch(`${base}/processes/slow/execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "respond-async" },
        body: JSON.stringify({ inputs: { seconds: 2 }, outputs: {} }),
      });
      return {
        status: response.status,
        location: response.headers.get("location"),
        body: await response.text(),
      };
    }, CORS);

    expect(result.status).toBe(201);
    // The job was created and the browser cannot name it: `Location` is
    // filtered out without `Access-Control-Expose-Headers`, and pygeoapi's
    // async 201 body is the literal `null` (finding 0004), so the body-link
    // fallback has nothing to work with either.
    expect(result.location).toBeNull();
    expect(result.body.trim()).toBe("null");
    // That combination is what `AmbiguousExecutionResponseError` reports, and
    // why the relay's route B exists: e2e/relay-async.spec.ts runs the same
    // execute through it and names the job. `listJobs()` reaches the job too,
    // but only on the list's last page and without telling whose it is
    // (findings 0038 and 0039).
  });

  test("no-CORS port: a browser cannot read a job status at all", async ({ page }) => {
    test.skip(!(await reachable(NOCORS)), "pygeoapi :5081 is not answering");
    const jobUrl = await startJob(NOCORS, 30);

    const result = await probe(page, jobUrl, "GET");

    expect(result.ok).toBe(false);
  });

  test("no-CORS port: the DELETE preflight fails, so dismissal is unreachable", async ({
    page,
  }) => {
    test.skip(!(await reachable(NOCORS)), "pygeoapi :5081 is not answering");
    const jobUrl = await startJob(NOCORS, 30);

    // :5081 answers `OPTIONS` with a 200 and no CORS headers whatsoever, so the
    // browser never sends the DELETE. The relay does not help: it carries the
    // execute and nothing else, by design, so this port is blocked
    // for dismissal from a browser — finding 0049.
    const result = await probe(page, jobUrl, "DELETE");

    expect(result.ok).toBe(false);
  });
});
