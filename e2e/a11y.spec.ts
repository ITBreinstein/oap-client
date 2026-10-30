/**
 * axe over every state a visitor meets, in both versions of Instrument, light
 * and dark: the start screen, the relay question, the process list, the side
 * panels and Appearance, a form (and one the page refused), drawing on the
 * map, and a result. Each must have no violation at all.
 *
 * `config.json` allows examples on https: services only, so the preset and
 * the examples name a test address, which this spec answers from the local
 * pygeoapi; the relay is the lane's own, for the relay question.
 */

import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { RELAY } from "./servers.js";
import { requireService } from "./services.js";
import { CONNECTED } from "./waits.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";

/** A map style with nothing to fetch, standing in for OpenFreeMap's. */
const WORLD_STAND_IN = {
  version: 8,
  sources: {},
  layers: [{ id: "land", type: "background", paint: { "background-color": "#f8f4f0" } }],
};

const ONE_PLOT = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Plot, north" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [5.38, 52.16],
            [5.39, 52.16],
            [5.39, 52.165],
            [5.38, 52.16],
          ],
        ],
      },
    },
  ],
};

async function open(page: Page, style: string, theme: string) {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        relay: { url: RELAY },
        presets: [{ title: "Reference pygeoapi", url: SERVICE }],
        examples: [
          {
            service: SERVICE,
            process: "hello-world",
            title: "Hello World",
            summary: "Type a name; the service greets it back.",
            needs: "values",
            featured: true,
          },
          {
            service: SERVICE,
            process: "breinstein-buildings",
            title: "Buildings in an area",
            summary: "Draw a shape; get the buildings inside it.",
            needs: "area",
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
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  // No slides or fades to wait out: what axe reads is what stays on screen.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?style=${style}&theme=${theme}`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

/** axe over the whole page as it stands: no violation, named by the state. */
async function noViolations(page: Page, state: string) {
  await test.step(state, async () => {
    const { violations } = await new AxeBuilder({ page }).analyze();
    const found = violations.map(
      (violation) =>
        `${violation.id} (${String(violation.impact)}): ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    );
    expect(found, `axe violations, ${state}`).toEqual([]);
  });
}

async function toList(page: Page) {
  await page.getByRole("button", { name: "Processes", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
}

async function openProcess(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

test.beforeEach(async () => {
  await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
  await requireService(`${RELAY}/healthz`, "the relay");
});

/** Connected to the reference pygeoapi, its process list on screen. */
async function connectReference(page: Page) {
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible(CONNECTED);
}

// The walk, in five parts per style and theme: every state of the one long
// test it was, which under load ran past 90 s on axe alone (2026-10-26).
for (const style of ["instrument", "instrument-updated"] as const) {
  for (const theme of ["light", "dark"] as const) {
    const walk = `no axe violations, ${style}, ${theme}`;

    test(`${walk}: the start screen, Appearance and the relay question`, async ({ page }) => {
      await open(page, style, theme);
      await noViolations(page, "the start screen");

      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Appearance" })).toBeVisible();
      await noViolations(page, "Appearance open");
      await page.keyboard.press("Escape");

      // The relay question: an endpoint the relay may read, which the page
      // can't read directly.
      await page.getByRole("radio", { name: /^pygeoapi[- ]nocors[- ]relay /i }).check();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByTestId("relay-confirm")).toBeVisible({ timeout: 20_000 });
      await noViolations(page, "the relay question");
    });

    test(`${walk}: the process list, Examples, My jobs and About`, async ({ page }) => {
      await open(page, style, theme);
      await connectReference(page);
      await noViolations(page, "the process list");

      for (const [item, name] of [
        ["Examples", "Examples"],
        ["Jobs", "My jobs"],
        ["About", "About"],
      ] as const) {
        await page.getByRole("button", { name: item, exact: true }).click();
        await expect(page.getByRole("dialog", { name })).toBeVisible();
        await noViolations(page, `${name} open`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name })).toBeHidden();
      }
    });

    test(`${walk}: a form, a form the page refused, dates`, async ({ page }) => {
      await open(page, style, theme);
      await connectReference(page);
      await openProcess(page, "Every input kind");
      await noViolations(page, "a form");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.locator(".field.has-error").first()).toBeVisible();
      await noViolations(page, "a form the page refused");

      await toList(page);
      await openProcess(page, "Dates and times");
      await noViolations(page, "a date and a date-time");
    });

    test(`${walk}: drawing on the map`, async ({ page }) => {
      await open(page, style, theme);
      await connectReference(page);
      await openProcess(page, "Buildings in an area");
      await page.locator(".map-pane canvas").waitFor();
      await page.getByRole("button", { name: "Draw on the map" }).click();
      await expect(page.getByRole("button", { name: "Stop drawing" })).toBeVisible();
      await noViolations(page, "drawing on the map");
    });

    test(`${walk}: a result`, async ({ page }) => {
      // A run: connecting, the form, and up to 30 s for the result.
      test.setTimeout(60_000);
      await open(page, style, theme);
      await connectReference(page);
      await openProcess(page, "Area of each feature");
      await page.getByRole("textbox", { name: "Value (JSON)" }).fill(JSON.stringify(ONE_PLOT));
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.locator('[data-output-id="table"]')).toBeVisible({ timeout: 30_000 });
      await noViolations(page, "a result");
    });
  }
}

// #F3, in a test of its own so the walk above keeps its time: an output
// offered in several formats, the one asked for said in words, and its result.
for (const style of ["instrument", "instrument-updated"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`no axe violations with a format asked for, ${style}, ${theme}`, async ({ page }) => {
      await open(page, style, theme);
      await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
      await openProcess(page, "An area, in a format of your choice");
      await expect(page.getByTestId("format-line")).toBeVisible();
      await noViolations(page, "a format asked for");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.locator('[data-output-id="features"]')).toBeVisible({ timeout: 30_000 });
      await noViolations(page, "a result in the format asked for");
      // A request the stand-in route is still forwarding when the test ends
      // would fail outside any test.
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });
  }
}

// Phase 3: GML and KML on the map, the lines that say how they were placed,
// and GML that names no coordinate system. A test of their own, as above.
for (const style of ["instrument", "instrument-updated"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`no axe violations with GML and KML results, ${style}, ${theme}`, async ({ page }) => {
      await open(page, style, theme);
      await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
      await openProcess(page, "An area as KML, with HTML in it");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.locator('[data-output-id="placemarks"]')).toHaveAttribute(
        "data-plotted",
        "true",
        { timeout: 30_000 },
      );
      await noViolations(page, "a KML result on the map");
      await open(page, style, theme);
      await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await openProcess(page, "An area as GML, as ZOO-Project writes it");
      await page.getByRole("combobox", { name: "srsName" }).selectOption("none");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.getByTestId("placement")).toBeVisible({ timeout: 30_000 });
      await noViolations(page, "GML that names no coordinate system");
      await page.unrouteAll({ behavior: "ignoreErrors" });
    });
  }
}
