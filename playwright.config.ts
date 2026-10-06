import { defineConfig } from "@playwright/test";
import { relayBuild, webBuild } from "./e2e/fingerprint.js";
import { RELAY, WEB } from "./e2e/servers.js";

const CI = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "e2e",
  // Keep run output out of the repo root; .playwright/ is a single ignored dir.
  outputDir: ".playwright/results",
  fullyParallel: true,
  forbidOnly: CI,
  reporter: CI ? [["html", { outputFolder: ".playwright/report" }]] : "list",
  use: { baseURL: WEB },
  // Refuses a relay or web build on the lane's ports that this checkout did
  // not make. Runs after the servers below are started, or found running.
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    // `pnpm test:e2e`: blocks CI. pygeoapi only, from infra/compose.
    { name: "blocking", testIgnore: /zoo-browser\.spec\.ts/, grepInvert: /@pdok/ },
    // `pnpm test:e2e:pdok`: the tests that reach PDOK (tagged PDOK_LANE in
    // e2e/services.ts). Opt-in: a third party's uptime must not block a merge.
    { name: "pdok", testIgnore: /zoo-browser\.spec\.ts/, grep: /@pdok/ },
    // `pnpm test:e2e:zoo`: ZOO-Project from a browser. Reports, never blocks:
    // ZOO is a second implementation built from source, and its worker pool
    // runs out as it is used (finding 0044). See .github/workflows/interop.yml.
    { name: "zoo", testMatch: /zoo-browser\.spec\.ts/ },
    // `pnpm capture:observations`: not a test lane. Drives the client against
    // the local stack and saves the matrix's evidence, one export per
    // endpoint. See e2e/observations.capture.ts.
    { name: "capture", testMatch: /observations\.capture\.ts/, fullyParallel: false },
  ],
  webServer: [
    {
      // The relay, built from this checkout first, with the lane's own config:
      // pygeoapi :5080 with callbacks on, and :5081 and ZOO relay-routed so
      // their browser failures are visible. On the lane's own port, never a
      // developer's (e2e/servers.ts).
      command: "pnpm --filter @breinstein/relay build && pnpm --filter @breinstein/relay start",
      // e2e/relay.json's endpoints are on localhost, which takes both keys:
      // their `allowPrivateNetwork`, and this variable. Without it the relay
      // refuses to start.
      env: {
        RELAY_CONFIG: "../../e2e/relay.json",
        RELAY_ALLOW_PRIVATE_ADDRESSES: "1",
        PORT: new URL(RELAY).port,
        RELAY_BUILD_ID: relayBuild(),
      },
      url: `${RELAY}/healthz`,
      reuseExistingServer: !CI,
    },
    {
      // One production build for every spec, stamped with what it was built
      // from. The relay's URL is not built in: it comes from config.json at
      // run time, and this lane serves the relay one. The static-only spec
      // answers /config.json itself.
      command: [
        "pnpm --filter @breinstein/web build",
        "cp e2e/config.relay.json apps/web/dist/config.json",
        `printf %s ${webBuild()} > apps/web/dist/e2e-build.txt`,
        `pnpm --filter @breinstein/web exec vite preview --port ${new URL(WEB).port} --strictPort`,
      ].join(" && "),
      url: WEB,
      reuseExistingServer: !CI,
    },
  ],
});
