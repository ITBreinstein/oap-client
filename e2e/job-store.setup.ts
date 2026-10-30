/**
 * Before a lane that uses the lane's pygeoapi, its job stores are kept small
 * (`e2e/job-store.ts`). A setup project the blocking and PDOK lanes depend on,
 * not the global setup: the global setup runs for every lane, and the ZOO
 * lane's, running beside the blocking one, dismissed pygeoapi jobs in the
 * middle of the blocking run — 22 in 4 s, followed by an 18 s stall of
 * pygeoapi and four failed tests (2026-10-26).
 */

import { test } from "@playwright/test";
import { pruneFinishedJobs, prunedLine } from "./job-store.js";

test("the lane's pygeoapi job stores are kept small", async () => {
  // The worst measured: 1 110 jobs in 18 s. Over 30 s, the line says so.
  test.setTimeout(120_000);
  for (const [name, base] of [
    ["pygeoapi :5080", "http://localhost:5080"],
    ["pygeoapi :5081", "http://localhost:5081"],
  ] as const) {
    let line: string;
    try {
      line = prunedLine(name, await pruneFinishedJobs(base));
    } catch (error) {
      // A server that is not up is left to requireService to report.
      line = `${name}: job store not checked (${String(error)}).`;
    }
    console.log(line);
    test.info().annotations.push({ type: "job store", description: line });
  }
});
