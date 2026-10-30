/**
 * Phase 3 of the result-formats brief, and #F1's two end-to-end checks,
 * against the pinned pygeoapi only (no network):
 *
 * - #F1: RD New behind a link (`breinstein-rd-link`, pygeoapi's own features
 *   API sending `Content-Crs`) lands where the CRS84 answer for the same
 *   features does; and `breinstein-gml` in EPSG:28992 lands where its
 *   EPSG:4326 variant does.
 * - #F4 GML and #F5 KML are on the map, with their properties beside it, the
 *   HTML in a KML description as text. GML with no `srsName` is not placed,
 *   and says why.
 *
 * "Where it lands" is the map's own view once it has moved to the result
 * (`data-view`: its centre to three decimals and its zoom), which is where
 * the page put the shapes, compared between two runs of the same features.
 */

import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { requireService } from "./services.js";
import { RELAY } from "./servers.js";

const CORS = "http://localhost:5080";
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

test.beforeEach(async () => {
  await requireService(`${CORS}/`, "pygeoapi :5080");
});

async function connect(page: Page, query = "") {
  await page.goto(`/${query}`);
  const typed = page.getByRole("radio", { name: "Another service" });
  if (await typed.isVisible()) await typed.check();
  await page.getByRole("textbox", { name: "Service address" }).fill(CORS);
  await page.getByRole("button", { name: "Connect" }).click();
}

async function openProcess(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

async function run(page: Page) {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible({ timeout: 15_000 });
}

async function changeInputs(page: Page) {
  await page.getByRole("button", { name: "Change the inputs" }).click();
}

/** The map's view once it has stopped moving: centre and zoom. */
async function settledView(page: Page): Promise<[number, number, number]> {
  const canvas = page.locator(".map-canvas");
  let last = "";
  await expect
    .poll(
      async () => {
        const now = (await canvas.getAttribute("data-view")) ?? "";
        const same = now !== "" && now === last;
        last = now;
        return same;
      },
      { timeout: 15_000, intervals: [400] },
    )
    .toBe(true);
  const [lon = Number.NaN, lat = Number.NaN, zoom = Number.NaN] = last.split(",").map(Number);
  return [lon, lat, zoom];
}

function expectSamePlace(a: readonly number[], b: readonly number[]) {
  // Three decimals of a degree is about 70 m here; the result is a few
  // hundred metres across, so a misplaced one would be far off.
  expect(Math.abs((a[0] ?? 0) - (b[0] ?? 0))).toBeLessThanOrEqual(0.001);
  expect(Math.abs((a[1] ?? 0) - (b[1] ?? 0))).toBeLessThanOrEqual(0.001);
  expect(Math.abs((a[2] ?? 0) - (b[2] ?? 0))).toBeLessThanOrEqual(0.1);
}

async function exportedResults(page: Page): Promise<Record<string, unknown>[]> {
  await page.locator("details.developer").evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download session observations" }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8")) as {
    observations: Record<string, unknown>[];
  };
  return exported.observations.filter((observation) => observation["kind"] === "result");
}

/** Click the map a little off its middle: inside the result, clear of a point or a line through it. */
async function clickInside(page: Page): Promise<Locator> {
  const canvas = page.locator(".map-canvas canvas").first();
  const area = await canvas.boundingBox();
  if (area === null) throw new Error("the map has no size");
  await page.mouse.click(area.x + area.width * 0.56, area.y + area.height * 0.56);
  const panel = page.getByTestId("feature-properties");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("#F1: RD New lands where its CRS84 does", () => {
  /** Run breinstein-rd-link in RD New and in CRS84, Load each, and where each landed. */
  async function bothLinks(page: Page) {
    await openProcess(page, "Areas in RD New, by reference");
    await run(page);
    const areas = page.locator('[data-output-id="areas"]');
    await areas.getByRole("button", { name: "Load" }).click();
    await expect(areas).toHaveAttribute("data-reference-outcome", "ok");
    const rdLines = await areas.locator(".muted").allTextContents();
    const rdPlotted = (await areas.getAttribute("data-plotted")) === "true";
    const rd = rdPlotted ? await settledView(page) : undefined;

    await changeInputs(page);
    await page.getByRole("combobox", { name: "Coordinate system" }).selectOption(CRS84);
    await run(page);
    await areas.getByRole("button", { name: "Load" }).click();
    await expect(areas).toHaveAttribute("data-plotted", "true");
    const crs84 = await settledView(page);
    return { areas, rdLines, rd, crs84 };
  }

  test("through the relay, which exposes Content-Crs: reprojected, and lands where CRS84 does", async ({
    page,
  }) => {
    await requireService(`${RELAY}/healthz`, "the relay");
    await page.goto("/?developer");
    await page.getByRole("radio", { name: /^pygeoapi-nocors-relay / }).check();
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "Use relay" }).click();
    const { rdLines, rd, crs84 } = await bothLinks(page);
    expect(rdLines).toContain(
      "Its coordinates are in RD New (EPSG:28992), as its Content-Crs says: reprojected to longitude and latitude to put it on the map.",
    );
    if (rd === undefined) throw new Error("RD New was not plotted");
    expectSamePlace(rd, crs84);
    // Utrecht.
    expect(rd[0]).toBeCloseTo(5.12, 1);
    expect(rd[1]).toBeCloseTo(52.09, 1);

    const loads = (await exportedResults(page)).filter(
      (record) => record["referenceOutcome"] === "ok",
    );
    expect(loads[0]).toMatchObject({
      referenceRoute: "relay",
      contentCrs: "http://www.opengis.net/def/crs/EPSG/0/28992",
      sourceCrs: "EPSG:28992",
      crsFrom: "content-crs",
      reprojected: true,
    });
    expect(loads[1]).toMatchObject({
      referenceRoute: "relay",
      contentCrs: CRS84,
      sourceCrs: "CRS84",
    });
    expect(loads[1]).not.toHaveProperty("reprojected");
  });

  test("directly from :5080, whose Content-Crs a page cannot read: not placed, said, recorded", async ({
    page,
  }) => {
    // pygeoapi 0.21.0 sends Content-Crs and no Access-Control-Expose-Headers,
    // so the page sees no header at all. Recorded, not worked around.
    await connect(page, "?developer");
    const { rdLines, rd } = await bothLinks(page);
    expect(rd).toBeUndefined();
    expect(rdLines).toContain(
      "GeoJSON, but its coordinates are not longitude and latitude, and the service didn't say which coordinate system they are in, so it is not shown on the map.",
    );
    expect(rdLines.join(" ")).toContain("Access-Control-Expose-Headers");
    const loads = (await exportedResults(page)).filter(
      (record) => record["referenceOutcome"] === "ok",
    );
    expect(loads[0]).toMatchObject({ referenceRoute: "direct" });
    expect(loads[0]).not.toHaveProperty("contentCrs");
    expect(loads[0]).not.toHaveProperty("sourceCrs");
  });

  test("breinstein-gml in EPSG:28992 lands where its EPSG:4326 variant does", async ({ page }) => {
    await connect(page);
    await openProcess(page, "An area as GML, as ZOO-Project writes it");
    await run(page);
    const features = page.locator('[data-output-id="features"]');
    await expect(features).toHaveAttribute("data-plotted", "true");
    await expect(features).toContainText("GML: shown on the map in blue.");
    await expect(features.getByTestId("placement")).toHaveText(
      "Its srsName is EPSG:4326, which GML writes longitude first: shown as sent.",
    );
    const wgs84 = await settledView(page);

    await changeInputs(page);
    await page.getByRole("combobox", { name: "srsName" }).selectOption("EPSG:28992");
    await run(page);
    await expect(features).toHaveAttribute("data-plotted", "true");
    await expect(features.getByTestId("placement")).toHaveText(
      "Its coordinates are in RD New (EPSG:28992), as its srsName says: reprojected to longitude and latitude to put it on the map.",
    );
    expectSamePlace(await settledView(page), wgs84);
  });
});

test.describe("GML and KML on the map (#F4, #F5)", () => {
  test("GML: its features' properties beside the map, as text", async ({ page }) => {
    await connect(page);
    await openProcess(page, "An area as GML, as ZOO-Project writes it");
    await run(page);
    await expect(page.locator(".map-canvas")).toHaveAttribute("data-result-shapes", "2");
    await settledView(page);
    const panel = await clickInside(page);
    await expect(panel).toContainText("From the result “features”.");
    expect(await panel.locator("dt").allTextContents()).toEqual(["name", "kind"]);
    expect(await panel.locator("dd").allTextContents()).toEqual(["The area given", "area"]);
  });

  test("GML with no srsName: read, not placed, and said why", async ({ page }) => {
    await connect(page);
    await openProcess(page, "An area as GML, as ZOO-Project writes it");
    await page.getByRole("combobox", { name: "srsName" }).selectOption("none");
    await run(page);
    const features = page.locator('[data-output-id="features"]');
    await expect(features.getByTestId("placement")).toHaveText(
      "The service didn't say which coordinate system these coordinates are in, so they are not shown on the map.",
    );
    await expect(features).not.toHaveAttribute("data-plotted", "true");
    await expect(page.locator(".map-canvas")).toHaveAttribute("data-result-shapes", "0");
  });

  test("KML: plotted, heights left out, and the HTML in a description shown as text", async ({
    page,
  }) => {
    await connect(page, "?developer");
    await openProcess(page, "An area as KML, with HTML in it");
    await run(page);
    const placemarks = page.locator('[data-output-id="placemarks"]');
    await expect(placemarks).toHaveAttribute("data-plotted", "true");
    await expect(placemarks).toContainText("KML: shown on the map in blue.");
    await expect(placemarks).toContainText("Its heights are left out: the map is flat.");
    await expect(page.locator(".map-canvas")).toHaveAttribute("data-result-shapes", "5");
    await settledView(page);

    const panel = await clickInside(page);
    expect(await panel.locator("dt").allTextContents()).toEqual(["name", "description"]);
    await expect(panel.locator("dd").nth(1)).toContainText('<script>alert("not run")</script>');
    await expect(panel.locator("script, img, h3 + p b")).toHaveCount(0);

    const [record] = await exportedResults(page);
    expect(record).toMatchObject({
      mediaType: "application/vnd.google-earth.kml+xml",
      parsedAs: "kml",
      sourceCrs: "CRS84",
      crsFrom: "kml",
    });
    expect(record).not.toHaveProperty("sniffed");
  });

  test("breinstein-formats asked for GML 3.2: read and plotted, nothing else said", async ({
    page,
  }) => {
    await connect(page);
    await openProcess(page, "An area, in a format of your choice");
    await page
      .getByRole("combobox", { name: "Format of “Features”" })
      .selectOption("application/gml+xml; version=3.2");
    await run(page);
    const features = page.locator('[data-output-id="features"]');
    await expect(features).toHaveAttribute("data-plotted", "true");
    await expect(features).toContainText("GML: shown on the map in blue.");
    await expect(features.getByTestId("format-sent")).toHaveCount(0);
  });
});
