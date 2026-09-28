import { defineConfig } from "@playwright/test";

/** Where the relay listens for these tests. Also baked into the web build below. */
const RELAY = "http://localhost:8787";

export default defineConfig({
  testDir: "e2e",
  // Keep run output out of the repo root; .playwright/ is a single ignored dir.
  outputDir: ".playwright/results",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? [["html", { outputFolder: ".playwright/report" }]] : "list",
  use: { baseURL: "http://localhost:4173" },
  webServer: [
    {
      // The relay, with the CI config: pygeoapi :5080 with callbacks on, and
      // :5081 and ZOO relay-routed so their browser failures are visible.
      // Needs `pnpm build` first; `pnpm verify` does that.
      command: "pnpm --filter @breinstein/relay start",
      env: { RELAY_CONFIG: "../../infra/relay/ci.json", PORT: "8787" },
      url: `${RELAY}/healthz`,
      reuseExistingServer: !process.env["CI"],
    },
    {
      // One production build for every spec. The relay's URL is not built in:
      // it comes from config.json at run time, and this lane serves the relay
      // one. The static-only spec answers /config.json itself.
      command:
        "pnpm --filter @breinstein/web build && cp e2e/config.relay.json apps/web/dist/config.json && pnpm --filter @breinstein/web preview",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env["CI"],
    },
  ],
});
