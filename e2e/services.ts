/**
 * The reference services a spec needs, and what happens when one is down.
 *
 * Locally, a spec whose service is not running is skipped and says why, so
 * the rest of the lane still runs on a laptop with only some of them up. In
 * CI a missing reference service is a broken run and fails it: a blocking
 * lane that quietly skipped its tests used to show green with nothing tested
 * (review T3).
 *
 * PDOK is not ours to start, so a spec that needs it skips everywhere, CI
 * included, and says so ({@link requireNetwork}).
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

/** A third-party service on the internet, which no lane starts. */
export async function requireNetwork(url: string, name: string): Promise<void> {
  test.skip(!(await answering(url)), `${name} is not answering at ${url}`);
}
