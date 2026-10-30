/**
 * #F3 in the browser, against the pinned pygeoapi: an output offered in
 * several formats is asked for one the page can show, the form says which in
 * words, and another can be picked before running. And, run from Node with the
 * web app's own request building, asking for a format leaves the answer's
 * shape as it was (see `format-shape.ts`).
 *
 * `breinstein-formats` (infra/pygeoapi/plugins/breinstein_formats.py) offers
 * its `features` output as GeoJSON, GML 3.2 and KML, and answers in the one
 * asked for.
 */

import { expect, test, type Page } from "@playwright/test";
import { shapesWithAndWithoutFormats } from "./format-shape.js";
import { requireService } from "./services.js";

const CORS = "http://localhost:5080";
const TITLE = "An area, in a format of your choice";
const GEOJSON = "application/geo+json";
const GML = "application/gml+xml; version=3.2";
const KML = "application/vnd.google-earth.kml+xml";

test.beforeEach(async () => {
  await requireService(`${CORS}/`, "pygeoapi :5080");
});

async function open(page: Page): Promise<void> {
  await page.goto("/");
  const typed = page.getByRole("radio", { name: "Another service" });
  if (await typed.isVisible()) await typed.check();
  await page.getByRole("textbox", { name: "Service address" }).fill(CORS);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: TITLE, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible();
}

function formatOf(page: Page) {
  return page.getByRole("combobox", { name: "Format of “Features”" });
}

async function runAndReadBody(page: Page): Promise<Record<string, unknown>> {
  const sent = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("breinstein-formats"),
  );
  await page.getByRole("button", { name: "Run", exact: true }).click();
  return (await sent).postDataJSON() as Record<string, unknown>;
}

test.describe("asking for a format (#F3)", () => {
  test("breinstein-formats asks for GeoJSON, says so, and its answer goes on the map", async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByTestId("format-line")).toHaveText(
      "Asked for GeoJSON; the service also offers GML and KML.",
    );
    await expect(formatOf(page)).toHaveValue(GEOJSON);
    const body = await runAndReadBody(page);
    // Every output listed, as before; a format only for the one that offers several.
    expect(body["outputs"]).toEqual({ features: { format: { mediaType: GEOJSON } }, count: {} });
    const features = page.locator('[data-output-id="features"]');
    await expect(features).toHaveAttribute("data-plotted", "true", { timeout: 15_000 });
    await expect(features.getByTestId("format-sent")).toHaveCount(0);
  });

  test("another format is picked before running, said, and sent", async ({ page }) => {
    await open(page);
    await formatOf(page).selectOption(KML);
    await expect(page.getByTestId("format-line")).toHaveText(
      "Asked for KML; the service also offers GeoJSON and GML.",
    );
    const body = await runAndReadBody(page);
    expect(body["outputs"]).toEqual({ features: { format: { mediaType: KML } }, count: {} });
    const features = page.locator('[data-output-id="features"]');
    await expect(features).toBeVisible({ timeout: 15_000 });
    // It came as asked: its qualified value says KML. Nothing to say.
    await expect(features.getByTestId("format-sent")).toHaveCount(0);
  });

  test("“Let the service choose” asks for no format at all", async ({ page }) => {
    await open(page);
    await formatOf(page).selectOption({ label: "Let the service choose" });
    await expect(page.getByTestId("format-line")).toHaveText(
      "Asked for no format: the service chooses. It offers GeoJSON, GML and KML.",
    );
    const body = await runAndReadBody(page);
    expect(body["outputs"]).toEqual({ features: {}, count: {} });
  });
});

test.describe("asking for a format leaves the answer's shape as it was (pygeoapi, 1.0)", () => {
  for (const [name, choice] of [
    ["the page's own choice, GeoJSON", undefined],
    ["GML", GML],
    ["KML", KML],
  ] as const) {
    for (const only of [undefined, ["features"]] as const) {
      const outputs = only === undefined ? "both outputs" : "features alone";
      test(`${name}, ${outputs}`, async () => {
        const pair = await shapesWithAndWithoutFormats({
          baseUrl: CORS,
          processId: "breinstein-formats",
          inputs: {},
          ...(only === undefined ? {} : { only }),
          ...(choice === undefined ? {} : { choices: { features: choice } }),
        });
        expect(pair.asked).toEqual({ features: choice ?? GEOJSON });
        expect(pair.with).toEqual(pair.without);
        expect(pair.with.form).toBe(only === undefined ? "document" : "raw");
      });
    }
  }
});
