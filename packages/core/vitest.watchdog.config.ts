import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The watchdog lane: tests that assert a **known defect is still there**.
 *
 * Deliberately its own lane, and deliberately not part of `pnpm test:interop`.
 * Everything here uses `it.fails`, so a passing test is the alarm: it means the
 * server stopped misbehaving and a finding needs re-reading. That inversion is
 * not something to mix into a lane whose red means "our client broke".
 *
 * It is also slow on purpose — the pool test runs two dozen asynchronous jobs
 * against ZOO and takes minutes — which is the second reason it is scheduled
 * rather than run on demand.
 *
 * Unlike `test:interop`, this lane does **not** refresh the worker pool before
 * every test: refreshing is the thing under test. `zoo.sh refresh` is run once
 * by the workflow before the file starts, and the tests own the state from
 * there.
 */
export default defineConfig({
  test: {
    name: "watchdog",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["test/watch/**/*.test.ts"],
    // A single deliberately depleted server. These files cannot share it.
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
