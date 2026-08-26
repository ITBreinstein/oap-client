import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Contract tests against the pinned pygeoapi in infra/compose/pygeoapi.yml.
// Kept out of `pnpm test` because they need Docker: `pnpm verify` must stay
// green on a laptop with the daemon stopped. Run them with `pnpm test:contract`
// after `docker compose -f infra/compose/pygeoapi.yml up -d --wait`.
//
// Unlike the interop lane, this one *is* deterministic — a pinned image, a
// checked-in config — so it blocks in CI.
export default defineConfig({
  test: {
    name: "contract",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["test/contract/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
