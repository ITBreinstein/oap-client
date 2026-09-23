import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The relay against the pinned pygeoapi, with real callbacks — see
// test/contract/callbacks.test.ts. Needs `docker compose -f
// infra/compose/pygeoapi.yml up -d --wait`, and the containers must be able to
// reach this machine as host.docker.internal (mapped in that compose file).
// Part of `pnpm test:contract`, so it blocks CI like the core's contract lane.
export default defineConfig({
  test: {
    name: "relay-contract",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["test/contract/**/*.test.ts"],
    testTimeout: 40_000,
    hookTimeout: 30_000,
  },
});
