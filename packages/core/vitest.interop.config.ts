import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live third-party servers. Never part of `pnpm test` — see .github/workflows/interop.yml.
// `root` is pinned to this file's directory: it is invoked from the repo root
// via `pnpm test:interop`, and vitest resolves a relative root against the cwd.
export default defineConfig({
  test: {
    name: "interop",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["test/interop/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Default file parallelism, deliberately restored.
    //
    // Task 5 set `fileParallelism: false` on the theory that parallel files
    // saturate a small ZOO worker pool. Characterising that pool (finding 0044,
    // `infra/zoo/characterise-pool.mjs`) showed the theory was wrong: ZOO's
    // asynchronous capacity decays at about one worker per job run and does not
    // recover, at the same rate whether the jobs are sequential or concurrent.
    // Concurrency is not the variable — total jobs run since the container
    // started is. Serialising does not fix that, it only changes how many runs
    // it takes to hit the wall: with the lane serialised, runs 1-3 passed, run
    // 4 took two and a half times as long, and run 5 failed.
    //
    // So the cause is addressed where it lives — `pnpm test:interop` restarts
    // `zoofpm` first — and the lane is free to run its files in parallel again.
  },
});
