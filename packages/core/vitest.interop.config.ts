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
  },
});
