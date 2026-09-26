/**
 * Outputs given by reference, in a browser (Task 8).
 *
 * The first three run in the blocking lane and never contact PDOK:
 *
 * - `breinstein-link` on `:5080` links to `:5081`, which sends no CORS
 *   headers (infra/README.md): a real origin a page cannot read, so the
 *   blocked path is the browser's own verdict, not a stub's.
 * - `breinstein-link` on `:5081`, read through the relay once the user says
 *   so, links back to `:5080`, which a page can read: an image, fetched
 *   directly, since the href is not under the relay-routed endpoint.
 * - `breinstein-buildings` asked for a link through the developer view (its
 *   description says value-only, finding 0059). Asked for a link, the process
 *   only builds the PDOK URL; the page's request for it is answered from the
 *   captured PDOK page.
 *
 * The last reaches PDOK itself and skips when PDOK is not answering.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";

const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";
const RELAY = "http://localhost:8787";
const PDOK = "https://api.pdok.nl/";
const FIXTURES = new URL("../packages/core/test/fixtures/", import.meta.url);

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5_000) })).ok;
  } catch {
    return false;
  }
}

/** Answer a route with a `curl -i` capture: its status, headers and body. */
async function fulfilFrom(route: Route, fixture: string) {
  const text = await readFile(new URL(fixture, FIXTURES), "utf8");
  const split = /\r?\n\r?\n/.exec(text);
  if (split === null) throw new Error(`${fixture} has no body`);
  const [statusLine = "", ...lines] = text.slice(0, split.index).split(/\r?\n/);
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).trim().toLowerCase();
    if (colon <= 0 || name === "transfer-encoding" || name === "content-length") continue;
    headers[name] = line.slice(colon + 1).trim();
  }
  await route.fulfill({
    status: Number(/^HTTP\/[\d.]+ (\d{3})/.exec(statusLine)?.[1]),
    headers,
    body: text.slice(split.index + split[0].length),
  });
}

async function connectTyped(page: Page, address: string, query = "") {
  await page.goto(`/${query}`);
  const typed = page.getByRole("radio", { name: "Another service" });
  if (await typed.isVisible()) await typed.check();
  await page.getByRole("textbox", { name: "Service address" }).fill(address);
  await page.getByRole("button", { name: "Connect" }).click();
}

async function openProcess(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

async function exportedResults(page: Page): Promise<Record<string, unknown>[]> {
  // Open, not toggled: `?developer` opens it already.
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

const BLOCK = [
  [5.118, 52.089],
  [5.124, 52.089],
  [5.124, 52.093],
  [5.118, 52.093],
  [5.118, 52.089],
];

async function askForBuildingsByLink(page: Page) {
  await openProcess(page, "Buildings in an area");
  await page
    .locator('[data-input-id="area"]')
    .getByLabel("Or load a GeoJSON file")
    .setInputFiles({
      name: "block.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(JSON.stringify({ type: "Polygon", coordinates: [BLOCK] })),
    });
  await page.getByRole("checkbox", { name: "Ask for “Buildings” as a link" }).check();
}

test.describe("outputs given by reference", () => {
  test.beforeEach(async () => {
    test.skip(!(await answering(`${CORS}/?f=json`)), "pygeoapi :5080 is not answering");
  });

  test("a link a page cannot read: nothing fetched until Load, then blocked, said and recorded", async ({
    page,
  }) => {
    test.skip(!(await answering(`${NOCORS}/?f=json`)), "pygeoapi :5081 is not answering");
    const toNocors: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(`${NOCORS}/`)) toNocors.push(request.url());
    });

    await connectTyped(page, CORS);
    await openProcess(page, "A link to a file on another server");
    // pygeoapi describes it as value-only (finding 0059): no Value/Link choice.
    await expect(page.locator("fieldset.outputs")).toHaveCount(0);
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const file = page.locator('[data-output-id="file"]');
    await expect(file).toHaveAttribute("data-kind", "reference");
    await expect(file).toContainText("a link, image/png, on localhost:5081");
    expect(toNocors).toEqual([]);

    await file.getByRole("button", { name: "Load" }).click();
    await expect(file).toHaveAttribute("data-reference-outcome", "cors-blocked");
    await expect(file).toContainText("localhost:5081 sends no CORS headers");
    const link = file.getByRole("link", { name: "Open the link" });
    await expect(link).toHaveAttribute("href", `${NOCORS}/static/img/logo.png`);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(toNocors).toEqual([`${NOCORS}/static/img/logo.png`]);

    const records = await exportedResults(page);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      outputId: "file",
      declaredTransmission: ["value"],
      requestedTransmission: "unspecified",
      receivedAs: "reference",
      referenceOrigin: NOCORS,
      referenceOutcome: "not-followed",
    });
    expect(records[1]).toMatchObject({
      runId: records[0]?.["runId"],
      referenceRoute: "direct",
      referenceOutcome: "cors-blocked",
    });
    expect(JSON.stringify(records)).not.toContain("logo.png");
  });

  test("a link a page can read, from a server it reads through the relay: loaded directly", async ({
    page,
  }) => {
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
    test.skip(!(await answering(`${NOCORS}/?f=json`)), "pygeoapi :5081 is not answering");
    await page.goto("/");
    await page.getByRole("radio", { name: /^pygeoapi-nocors-relay / }).check();
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "Use relay" }).click();

    await openProcess(page, "A link to a file on another server");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const file = page.locator('[data-output-id="file"]');
    await expect(file).toHaveAttribute("data-kind", "reference");

    const relayed: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(`${RELAY}/read/`)) relayed.push(request.url());
    });
    await file.getByRole("button", { name: "Load" }).click();
    await expect(file).toHaveAttribute("data-reference-outcome", "ok");
    await expect(file.getByRole("img")).toBeVisible();
    // The href is :5080's, not under the relay-routed :5081: never relayed (T4).
    expect(relayed).toEqual([]);
  });

  test("buildings by link through the developer view, PDOK answered from its capture", async ({
    page,
  }) => {
    const toPdok: string[] = [];
    await page.route(`${PDOK}**`, async (route) => {
      toPdok.push(route.request().url());
      await fulfilFrom(route, "pdok/bag-pand-items-default-page.http");
    });

    await connectTyped(page, CORS, "?developer");
    await askForBuildingsByLink(page);
    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" && candidate.url().includes("/breinstein-buildings/"),
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const sent = (await request).postDataJSON() as { outputs: Record<string, unknown> };
    expect(sent.outputs).toEqual({ buildings: { transmissionMode: "reference" } });

    const buildings = page.locator('[data-output-id="buildings"]');
    await expect(buildings).toHaveAttribute("data-kind", "reference");
    await expect(buildings).toContainText("a link, application/geo+json, on api.pdok.nl");
    expect(toPdok).toEqual([]);

    await buildings.getByRole("button", { name: "Load" }).click();
    await expect(buildings).toHaveAttribute("data-reference-outcome", "ok");
    await expect(buildings).toHaveAttribute("data-plotted", "true");
    await expect(buildings.locator("[data-truncated]")).toHaveText(
      "First page only: 10 features. The server has more; this page loads one page.",
    );
    await expect(page.locator(".map-canvas")).toHaveAttribute("data-result-shapes", "10");
    expect(toPdok).toHaveLength(1);

    const records = await exportedResults(page);
    expect(records.at(-1)).toMatchObject({
      requestedTransmission: "reference",
      declaredTransmission: ["value"],
      referenceOrigin: "https://api.pdok.nl",
      referenceOutcome: "ok",
      representation: "geojson",
      truncated: true,
      contentCrs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      axisSwapped: false,
    });
  });

  test("buildings by link from PDOK itself: the whole area on one page", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(
      !(await answering(`${PDOK}kadaster/bag/ogc/v2/collections/pand?f=json`)),
      "PDOK is not answering",
    );
    await connectTyped(page, CORS, "?developer");
    await askForBuildingsByLink(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const buildings = page.locator('[data-output-id="buildings"]');
    await buildings.getByRole("button", { name: "Load" }).click();
    await expect(buildings).toHaveAttribute("data-reference-outcome", "ok", { timeout: 45_000 });
    await expect(buildings).toHaveAttribute("data-plotted", "true");
    // 815 buildings on 2026-09-26, limit=1000, no `next`: nothing to say.
    await expect(buildings.locator("[data-truncated]")).toHaveCount(0);
    const shown = Number(await page.locator(".map-canvas").getAttribute("data-result-shapes"));
    expect(shown).toBeGreaterThan(100);
  });
});
