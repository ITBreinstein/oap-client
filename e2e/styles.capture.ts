/**
 * `pnpm capture:styles`: not a test lane. Screenshots of both versions of
 * Instrument × theme (ADR 0002) on the same path through the app, to compare
 * them:
 *
 *   start · Browse all open · list · Hello World's result · Buildings' form
 *   · My jobs open, with a background job in it
 *
 * at 1440×960, and once per version at 390×844. Saved to
 * `test-results/styles/<style>-<theme>[-mobile]-<screen>.png`, which git
 * ignores. Needs the lane's pygeoapi and relay, as the blocking specs do.
 *
 * `config.json` allows https: services only, so the examples name a test
 * address, which this file answers from the local pygeoapi.
 */

import { expect, test, type Page } from "@playwright/test";
import { RELAY } from "./servers.js";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";
const OUT = "test-results/styles";

const EXAMPLES = [
  [
    "breinstein-buildings",
    "Buildings in an area",
    "Draw a shape; get the buildings inside it.",
    "area",
    true,
  ],
  [
    "breinstein-aerial",
    "Aerial photograph of an area",
    "Draw a shape; get the current aerial photograph of its box.",
    "area",
    true,
  ],
  [
    "breinstein-feature-area",
    "Area of each feature",
    "Give GeoJSON features; get each one back with its area.",
    "data",
    true,
  ],
  ["hello-world", "Hello World", "Type a name; the service greets it back.", "values", true],
  [
    "breinstein-bbox",
    "Bounding box to feature",
    "Draw a box; get it back as a GeoJSON feature.",
    "area",
    false,
  ],
  ["breinstein-png", "Generated PNG", "Pick a size; get a small square PNG back.", "values", false],
  ["slow", "Slow process", "Waits a number of seconds; good for background runs.", "values", false],
].map(([process, title, summary, needs, featured]) => ({
  service: SERVICE,
  process,
  title,
  summary,
  needs,
  featured,
}));

async function prepare(page: Page) {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ relay: { url: RELAY }, presets: [], examples: EXAMPLES }),
    }),
  );
  await page.route(`${SERVICE}/**`, async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace(SERVICE, PYGEOAPI),
    });
    await route.fulfill({ response });
  });
}

/** Give a transition and the basemap a moment, then shoot. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

const RUNS = [
  ...(["instrument", "instrument-updated"] as const).flatMap((style) =>
    (["light", "dark"] as const).map((theme) => ({ style, theme, mobile: false })),
  ),
  ...(["instrument", "instrument-updated"] as const).map((style) => ({
    style,
    theme: "light" as const,
    mobile: true,
  })),
];

test.describe("styles", () => {
  test.beforeEach(async () => {
    await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
    await requireService(`${RELAY}/healthz`, "the relay");
  });

  for (const { style, theme, mobile } of RUNS) {
    const tag = `${style}-${theme}${mobile ? "-mobile" : ""}`;
    test(tag, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
      );
      await prepare(page);
      await page.goto(`/?style=${style}&theme=${theme}`);
      await page.evaluate(() => {
        localStorage.clear();
      });
      await page.reload();
      await page.getByRole("radio", { name: /pygeoapi-cors/ }).waitFor();
      await shot(page, `${tag}-1-start`);

      await page.getByRole("button", { name: /Browse all/ }).click();
      await shot(page, `${tag}-2-browse-all`);
      await page.keyboard.press("Escape");
      // Out of sight once its slide is over: until then its buttons are on screen.
      await expect(page.getByRole("complementary", { name: "Examples" })).toBeHidden();

      await page.getByRole("radio", { name: /pygeoapi-cors/ }).check();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.getByRole("button", { name: "Hello World", exact: true }).waitFor();
      await shot(page, `${tag}-3-list`);

      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("button", { name: "Change the inputs" }).waitFor();
      await shot(page, `${tag}-4-hello-result`);

      await page.getByRole("button", { name: "Choose another process" }).click();
      await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
      await page.locator(".map-pane canvas").waitFor();
      await page.waitForTimeout(2000);
      await shot(page, `${tag}-5-buildings-form`);

      // The way back beside the map is the rail's Processes item.
      await page.getByRole("button", { name: "Processes", exact: true }).click();
      await page.getByRole("button", { name: "Slow process", exact: true }).click();
      await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("1");
      await page.getByRole("checkbox", { name: "Run in the background" }).check();
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.locator('[data-output-id="slept"]').waitFor({ timeout: 30_000 });
      await page.getByRole("banner").getByRole("button", { name: /^Jobs/ }).click();
      await shot(page, `${tag}-6-my-jobs`);
    });
  }
});
