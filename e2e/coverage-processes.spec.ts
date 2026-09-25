/**
 * The coverage processes on the pinned pygeoapi (infra/README.md), each in a
 * browser: one execution mode, a job that fails partway, dates, a
 * FeatureCollection by reference with a CSV beside it, and a large GeoJSON
 * result. Assertions are on what the page sent and what it shows.
 *
 * Skips itself when pygeoapi is not answering, the background tests when the
 * relay is not, and the two that reach PDOK when PDOK is not.
 */

import { expect, test, type Page } from "@playwright/test";

const PYGEOAPI = "http://localhost:5080";
const RELAY = "http://localhost:8787";
const PDOK_BAG = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand";

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5_000) })).ok;
  } catch {
    return false;
  }
}

/** Connect to a typed address, which is always reached directly. */
async function connectTyped(page: Page) {
  await page.goto("/");
  const typed = page.getByRole("radio", { name: "Another service" });
  if (await typed.isVisible()) await typed.check();
  await page.getByRole("textbox", { name: "Service address" }).fill(PYGEOAPI);
  await page.getByRole("button", { name: "Connect" }).click();
}

/** Connect through the relay's configuration, which background runs need. */
async function connectConfigured(page: Page) {
  await page.goto("/");
  await page.getByRole("radio", { name: /^pygeoapi-cors / }).check();
  await page.getByRole("button", { name: "Connect" }).click();
}

async function openProcess(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

/**
 * pygeoapi describes every process as runnable both ways, whatever the process
 * declares (finding 0059). Put back what the process declares, so the page
 * sees the description a conformant server would send.
 */
async function declareOnly(page: Page, processId: string, modes: string[]) {
  await page.route(
    (url) => url.pathname === `/processes/${processId}`,
    async (route) => {
      const response = await route.fetch();
      const description = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...description, jobControlOptions: modes } });
    },
  );
}

test.describe("the coverage processes", () => {
  test.beforeEach(async () => {
    test.skip(!(await answering(`${PYGEOAPI}/?f=json`)), "pygeoapi :5080 is not answering");
  });

  test("offers no choice for a process that runs in the background only, and runs it there", async ({
    page,
  }) => {
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
    await declareOnly(page, "breinstein-async-only", ["async-execute"]);
    await connectConfigured(page);
    await openProcess(page, "Slow process, background only");

    await expect(page.getByRole("checkbox", { name: "Run in the background" })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("1");
    await page.getByRole("button", { name: "Run in the background", exact: true }).click();
    await expect(page.locator("[data-job-ref]")).toHaveAttribute("data-job-ref", /\/jobs\//, {
      timeout: 15_000,
    });
    await expect(page.locator('[data-output-id="slept"]')).toBeVisible({ timeout: 30_000 });
  });

  test("offers no choice for a process that runs in the foreground only", async ({ page }) => {
    await declareOnly(page, "breinstein-sync-only", ["sync-execute"]);
    await connectTyped(page);
    await openProcess(page, "Slow process, foreground only");

    await expect(page.getByRole("checkbox", { name: "Run in the background" })).toHaveCount(0);
    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" && candidate.url().includes("/breinstein-sync-only/"),
    );
    await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("0");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    // No preference for a process that has one mode: nothing to ask for.
    expect((await request).headers()["prefer"]).toBeUndefined();
    await expect(page.locator('[data-output-id="slept"]')).toBeVisible();
  });

  test("shows a background job that fails partway, with the server's reason", async ({ page }) => {
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
    await connectConfigured(page);
    await openProcess(page, "Process that fails after a while");

    await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("2");
    await page.getByRole("textbox", { name: "Message (optional)" }).fill("Out of coffee");
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();

    // Seen as a job first, then as a failure with the process's own words.
    await expect(page.locator("[data-job-ref]")).toHaveAttribute("data-job-ref", /\/jobs\//, {
      timeout: 15_000,
    });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The job failed on the server.", { timeout: 30_000 });
    await expect(alert).toContainText("Out of coffee");
  });

  test("sends a date and a date-time as typed, and shows what the server understood", async ({
    page,
  }) => {
    await connectTyped(page);
    await openProcess(page, "Dates and times");

    await page.getByRole("textbox", { name: "Day (required)" }).fill("2026-11-03");
    await page
      .getByRole("textbox", { name: "Moment (optional)" })
      .fill("2026-11-03T09:00:00+01:00");
    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" && candidate.url().includes("/breinstein-dates/"),
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    expect(((await request).postDataJSON() as { inputs: unknown }).inputs).toEqual({
      day: "2026-11-03",
      moment: "2026-11-03T09:00:00+01:00",
    });
    const understood = page.locator('[data-output-id="understood"]');
    await expect(understood).toContainText('"weekday": "Tuesday"');
    await expect(understood).toContainText('"utc": "2026-11-03T08:00:00Z"');
  });

  test("sends a FeatureCollection by reference, and shows the features on the map and as a table", async ({
    page,
  }) => {
    test.skip(!(await answering(`${PDOK_BAG}?f=json`)), "PDOK is not answering");
    await connectTyped(page);
    await openProcess(page, "Area of each feature");

    const features = page.locator('[data-input-id="features"]');
    await expect(features).toHaveAttribute("data-control", "complex");
    await features.getByRole("radio", { name: "Give a URL for the server to fetch" }).check();
    // A few buildings in central Utrecht.
    const href = `${PDOK_BAG}/items?f=json&bbox=5.120,52.090,5.121,52.091&limit=100`;
    await features.getByRole("textbox", { name: "URL" }).fill(href);

    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" && candidate.url().includes("/breinstein-feature-area/"),
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const sent = ((await request).postDataJSON() as { inputs: { features: { href: string } } })
      .inputs.features;
    expect(sent.href).toBe(href);

    // The process fetched it (pygeoapi does not, finding 0058) and says so.
    const measured = page.locator('[data-output-id="features"]');
    await expect(measured).toHaveAttribute("data-plotted", "true", { timeout: 30_000 });
    await expect(measured).toContainText('"by": "reference"');
    const table = page.locator('[data-output-id="table"]');
    await expect(table).toHaveAttribute("data-kind", "text");
    await expect(table).toContainText("number,id,geometry,area_m2");
    await expect(page.locator(".map-canvas")).not.toHaveAttribute("data-result-shapes", "0");
  });

  test("plots a GeoJSON result too large to show, and offers it as a download", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await answering(`${PDOK_BAG}?f=json`)), "PDOK is not answering");
    await connectTyped(page);
    await openProcess(page, "Buildings in an area");

    const area = page.locator('[data-input-id="area"]');
    // About 400 by 450 m of central Utrecht: some 800 buildings, over 1 MB.
    const ring = [
      [5.118, 52.089],
      [5.124, 52.089],
      [5.124, 52.093],
      [5.118, 52.093],
      [5.118, 52.089],
    ];
    await area.getByLabel("Or load a GeoJSON file").setInputFiles({
      name: "block.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(JSON.stringify({ type: "Polygon", coordinates: [ring] })),
    });
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const buildings = page.locator('[data-output-id="buildings"]');
    await expect(buildings).toHaveAttribute("data-kind", "download", { timeout: 45_000 });
    await expect(buildings).toContainText("too large to show here");
    await expect(buildings).toHaveAttribute("data-plotted", "true");
    const shown = Number(await page.locator(".map-canvas").getAttribute("data-result-shapes"));
    expect(shown).toBeGreaterThan(100);
  });
});
