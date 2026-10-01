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

/** A reference service this lane runs against: pygeoapi, ZOO, the relay. */
export async function requireService(url: string, name: string): Promise<void> {
  if (await answering(url)) return;
  if (process.env["CI"]) {
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
