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
    // One file at a time. ZOO is a single stateful deployment behind a small
    // FPM worker pool, not an isolated fixture: files running in parallel start
    // concurrent asynchronous jobs, saturate the pool, and then fail on
    // deadlines that say nothing about the client. Serialising costs a couple
    // of minutes and buys a lane whose red actually means something.
    fileParallelism: false,
  },
});
