import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Keep run output out of the repo root; .playwright/ is a single ignored dir.
  outputDir: ".playwright/results",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? [["html", { outputFolder: ".playwright/report" }]] : "list",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "pnpm --filter @breinstein/web preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env["CI"],
  },
});
