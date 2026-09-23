/**
 * Watchdog: ZOO's asynchronous capacity decays and does not recover.
 *
 * ## Read the result backwards
 *
 * The test below is `it.fails`. **A red test here is the good outcome** — it
 * means the defect in finding 0044 is still present and everything built on
 * top of it still holds. A *green* test means the capacity stopped decaying:
 * upstream fixed it, the pinned fork moved, or the deployment changed. When
 * that happens, finding 0044 must be re-read from the top, the `zoo.sh refresh`
 * pretask on `pnpm test:interop` becomes unnecessary, and the operational
 * warning in `infra/zoo/README.md` becomes wrong.
 *
 * Do not "fix" a green result by deleting the test. Re-measure with
 * `infra/zoo/characterise-pool.mjs`, then rewrite the finding.
 *
 * ## Why this is not in the interop lane
 *
 * Because it depletes the server on purpose. `pnpm test:interop` restarts
 * `zoofpm` first precisely so that its jobs run; this file needs the opposite
 * and would poison anything sharing the deployment. It is scheduled on its own
 * (`.github/workflows/watchdog.yml`) and runs after an explicit refresh.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ZOO, answering } from "../interop/zoo.js";
import { createClient, type Client } from "../../src/index.js";

const zooUp = await answering();

/**
 * `async_worker` in `infra/zoo/.conf/main-5090.cfg`, which is upstream's own
 * value. Capacity starts here and falls at about one per job without
 * recovering, so this is also roughly the number of asynchronous jobs the
 * deployment can run before it stops running any.
 */
const POOL_SIZE = 20;

/** Comfortably past the pool, so the last job cannot be the marginal one. */
const JOBS_TO_BURN = 24;

let client: Client;

beforeAll(() => {
  client = createClient({ baseUrl: ZOO });
});

/** One `longProcess` run: ~20 s of real work. Resolves with its final status. */
async function runOne(timeoutMs: number): Promise<string> {
  const execution = await client.execute("longProcess", {
    inputs: { sid: 1 },
    // ZOO refuses a body carrying only `inputs` — finding 0025.
    outputs: { Result: { transmissionMode: "value" } },
    mode: "async",
  });
  if (execution.kind !== "job") throw new Error("expected a job");

  const report = await client.pollJob(execution.job.statusUrl, {
    intervalMs: 2_000,
    timeoutMs,
  });
  return report.status?.status ?? "no-status";
}

describe.skipIf(!zooUp)("the ZOO asynchronous worker pool", () => {
  it.fails(
    `still runs a new job after ${String(JOBS_TO_BURN)} others — finding 0044, and it should not`,
    async () => {
      // Burn the pool. Sequential rather than concurrent: the cost is one
      // worker per job either way (that is the finding), and running them one
      // at a time keeps this from also being a load test.
      for (let i = 0; i < JOBS_TO_BURN; i += 1) {
        // Not asserted. Some of these will themselves be orphaned once the
        // pool runs low, and that is expected — the assertion is about the job
        // that comes after, on a deployment that has been handed far more work
        // than it has workers for.
        await runOne(45_000).catch(() => "orphaned");
      }

      // The assertion a healthy server would satisfy. On ZOO as pinned today,
      // this job is accepted, answered `201`, and then never runs: it stays
      // `running` until the deadline and `pollJob` gives up.
      const status = await runOne(60_000);
      expect(status).toBe("successful");
    },
  );

  it("names the pool size this expectation is built on, so a config change is visible", () => {
    // Not a server assertion — a tripwire on our own deployment. If someone
    // raises `async_worker`, `JOBS_TO_BURN` stops being past the pool and the
    // test above would go green for a reason that has nothing to do with
    // upstream fixing anything.
    expect(JOBS_TO_BURN).toBeGreaterThan(POOL_SIZE);
  });
});
