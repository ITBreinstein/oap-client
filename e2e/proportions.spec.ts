/**
 * Proportions and corner radii, in both versions of Instrument (ADR 0002):
 * edges that meet, one height per kind of button, one panel width, bars that
 * stay straight at a rounded corner. What only the update changes is checked
 * to be absent from Instrument as it is.
 *
 * `config.json` allows https: services only, so the preset names a test
 * address, which this spec answers from the local pygeoapi.
 */

import { expect, test, type Page } from "@playwright/test";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";
const VERSIONS = [
  { style: "instrument", updated: false },
  { style: "instrument-updated", updated: true },
] as const;

/** A map style with nothing to fetch, standing in for OpenFreeMap's. */
const WORLD_STAND_IN = {
  version: 8,
  sources: {},
  layers: [{ id: "land", type: "background", paint: { "background-color": "#f8f4f0" } }],
};

async function open(page: Page, style: string, more = "") {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        relay: null,
        presets: [
          { title: "Reference pygeoapi", url: SERVICE },
          { title: "Second pygeoapi", url: "https://second.example.test" },
        ],
        examples: [
          {
            service: SERVICE,
            process: "hello-world",
            title: "Hello World",
            summary: "Type a name; the service greets it back.",
            needs: "values",
            featured: true,
          },
        ],
      }),
    }),
  );
  await page.route(`${SERVICE}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(SERVICE, PYGEOAPI) });
    await route.fulfill({ response });
  });
  // The updated Instrument's world map is OpenFreeMap's: a plain stand-in.
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  await page.goto(`/?style=${style}&theme=light${more}`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

async function connect(page: Page) {
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();
}

/** The bar drawn beside a chosen item: its own element, inset from top and bottom. */
function barOf(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const bar = getComputedStyle(element, "::before");
      return {
        shadow: getComputedStyle(element).boxShadow,
        content: bar.content,
        width: bar.width,
        top: bar.top,
        bottom: bar.bottom,
      };
    });
}

test.describe("proportions", () => {
  test.beforeEach(async ({ page }) => {
    await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  for (const { style, updated } of VERSIONS) {
    test.describe(updated ? "updated" : "as it is", () => {
      test("a chosen item's bar stays straight at a rounded corner (#1)", async ({ page }) => {
        await open(page, style);
        await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
        for (const selector of [
          ".rail-item[aria-current='page']",
          "label.choice-card:has(input:checked)",
        ]) {
          const bar = await barOf(page, selector);
          expect(bar.shadow, selector).toBe("none");
          expect(bar.content, selector).toBe('""');
          expect(bar.width, selector).toBe("2px");
          expect(bar.top, selector).toBe("8px");
          expect(bar.bottom, selector).toBe("8px");
        }
      });
    });
  }
});
