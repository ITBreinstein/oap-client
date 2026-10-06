/**
 * The reference services a spec needs, and what happens when one is down.
 *
 * Locally, a spec whose service is not running is skipped and says why, so
 * the rest of the lane still runs on a laptop with only some of them up. In
 * CI a missing reference service is a broken run and fails it: a blocking
 * lane that quietly skipped its tests used to show green with nothing tested
 * (review T3).
 *
 * PDOK is the one exception, and an explicit one: no lane starts it, and a
 * blocking lane must not depend on a third party's uptime. The tests that
 * need it carry {@link PDOK_LANE} and run only in their own opt-in lane,
 * `pnpm test:e2e:pdok` (weekly in interop.yml); the blocking lane leaves them
 * out rather than skipping them. Inside that lane PDOK is a service like any
 * other: in CI, not answering fails.
 */

import { test } from "@playwright/test";

export async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5_000) })).ok;
  } catch {
    return false;
  }
}

/**
 * How long CI keeps asking a service that did not answer the first time. A
 * server can be up but busy: pygeoapi has four request workers, and the other
 * Playwright worker can hold all of them for longer than one five-second try.
 * That failed two CI runs on 2026-10-02 with the stack up. A stack that is
 * down still fails, this much later.
 */
const BUSY_GRACE_MS = 20_000;

/** A reference service this lane runs against: pygeoapi, ZOO, the relay. */
export async function requireService(url: string, name: string): Promise<void> {
  if (await answering(url)) return;
  if (process.env["CI"]) {
    // The grace comes on top of the test's own time, not out of it.
    const info = test.info();
    info.setTimeout(info.timeout + BUSY_GRACE_MS);
    const until = Date.now() + BUSY_GRACE_MS;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (await answering(url)) return;
    }
    throw new Error(
      `${name} is not answering at ${url}. In CI that fails the run rather than skipping the test: start it before the lane.`,
    );
  }
  test.skip(true, `${name} is not answering at ${url}`);
}

/**
 * The details that put a test in the PDOK lane, and keep it out of the
 * blocking one: `test("…", PDOK_LANE, async ({ page }) => …)`.
 */
export const PDOK_LANE = { tag: "@pdok" } as const;
