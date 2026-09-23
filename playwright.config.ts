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
      // Rebuilt with the relay's URL, which Vite bakes in at build time.
      command: "pnpm --filter @breinstein/web build && pnpm --filter @breinstein/web preview",
      env: { VITE_RELAY_URL: RELAY },
      url: "http://localhost:4173",
      reuseExistingServer: !process.env["CI"],
    },
  ],
});
