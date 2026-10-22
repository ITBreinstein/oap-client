/**
 * The UX review's fixes, in a browser, against the local pygeoapi: what a
 * visitor runs into first (Phase 1). Each test names the review's number.
 *
 * Behaviour that both versions of Instrument share is tested in both.
 */

import { expect, test, type Page } from "@playwright/test";
import { RELAY } from "./servers.js";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const STYLES = ["instrument", "instrument-updated"] as const;

/** A map style with nothing to fetch, standing in for OpenFreeMap's in the updated Instrument. */
const WORLD_STAND_IN = {
  version: 8,
  sources: {},
  layers: [{ id: "land", type: "background", paint: { "background-color": "#f8f4f0" } }],
};

async function open(page: Page, style: string, more = "") {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  await page.goto(`/?style=${style}&theme=light${more}`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

/** Connect to the local pygeoapi by its address, which is always reached directly. */
async function connectTyped(page: Page) {
  const typed = page.getByRole("radio", { name: /^Another service/ });
  if (await typed.isVisible()) await typed.check();
  await page.getByRole("textbox", { name: "Service address" }).fill(PYGEOAPI);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
}

async function openProcess(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

/** Back to the list: "All processes" where the version shows it, else the rail's Processes. */
async function toList(page: Page) {
  const breadcrumb = page.getByRole("button", { name: "All processes" });
  await (
    (await breadcrumb.isVisible())
      ? breadcrumb
      : page.getByRole("button", { name: "Processes", exact: true })
  ).click();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
}

const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

test.beforeEach(async () => {
  await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
});

for (const style of STYLES) {
  test.describe(style, () => {
    test("#10 a form's values survive All processes, Back, Start and reopening; Clear the form starts over", async ({
      page,
    }) => {
      await open(page, style);
      await connectTyped(page);
      await openProcess(page, "Every input kind");
      await field(page, "Label (required)").fill("Barcelona");
      await field(page, "Notes (required)").fill("Two lines\nof notes");
      await field(page, "Count (required)").fill("4");

      const expectKept = async () => {
        await expect(field(page, "Label (required)")).toHaveValue("Barcelona");
        await expect(field(page, "Notes (required)")).toHaveValue("Two lines\nof notes");
        await expect(field(page, "Count (required)")).toHaveValue("4");
      };

      // All processes, and back into it.
      await toList(page);
      await openProcess(page, "Every input kind");
      await expectKept();

      // The browser's Back, and back into it.
      await page.goBack();
      await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
      await openProcess(page, "Every input kind");
      await expectKept();

      // Start, the same service again, and back into it.
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(
        page.getByRole("heading", { level: 2, name: "Connect to a service" }),
      ).toBeVisible();
      await connectTyped(page);
      await openProcess(page, "Every input kind");
      await expectKept();

      // Clear the form: empty, and empty when it comes back.
      await page.getByRole("button", { name: "Clear the form" }).click();
      await expect(field(page, "Label (required)")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Clear the form" })).toBeHidden();
      await toList(page);
      await openProcess(page, "Every input kind");
      await expect(field(page, "Label (required)")).toHaveValue("");
      await expect(field(page, "Count (required)")).toHaveValue("");
    });
  });
}

/** The observations the page recorded, as the developer section lists them. */
async function observations(page: Page): Promise<Record<string, unknown>[]> {
  const texts = await page.locator(".observation-list pre").allTextContents();
  return texts.map((text): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
  });
}

for (const style of STYLES) {
  test(`#24 Stop waiting gives up on a long foreground run, back to the form (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Slow process");
    await field(page, "Seconds (optional)").fill("20");
    await page.getByRole("button", { name: "Run", exact: true }).click();

    await expect(page.getByTestId("waited")).toHaveText(/^Waiting for the service: \d+ s$/);
    await expect(page.getByTestId("waited")).toHaveText("Waiting for the service: 2 s", {
      timeout: 5_000,
    });
    await page.getByRole("button", { name: "Stop waiting" }).click();

    await expect(
      page.getByText("Stopped waiting. The service may still finish the run;"),
    ).toBeVisible();
    await expect(field(page, "Seconds (optional)")).toHaveValue("20");
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
    // Recorded as the core records any request that ended without an answer.
    const executions = (await observations(page)).filter((entry) => entry["kind"] === "execution");
    expect(executions.at(-1)?.["outcome"]).toBe("transport-failure");
  });
}

for (const style of STYLES) {
  test(`#25 a direct background run that can't be found turns the option off, and offers the relay (${style})`, async ({
    page,
  }) => {
    await requireService(`${RELAY}/healthz`, "the relay");
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Slow process");
    await field(page, "Seconds (optional)").fill("1");
    const background = page.getByRole("checkbox", { name: "Run in the background" });
    await background.check();
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("can’t tell this page where to find it", {
      timeout: 15_000,
    });
    await expect(alert).toContainText("The job may still be running on the service.");
    await expect(alert).not.toContainText("Location");
    await expect(alert).not.toContainText("0039");
    // Off, and stays off for this service this visit, saying why.
    await expect(background).not.toBeChecked();
    await expect(background).toBeDisabled();
    await expect(background).toHaveAccessibleDescription(
      "This service can’t tell a web page where its background jobs are.",
    );
    await toList(page);
    await openProcess(page, "Slow process");
    await expect(background).toBeDisabled();
    // The technical reason is for developers.
    await expect(page.getByTestId("developer-note")).toHaveCount(0);

    // Through the relay, which lists the same service: same process, same
    // form, Run in the background ticked.
    await page.getByRole("button", { name: "Use the relay for background runs" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Slow process" })).toBeVisible();
    await expect(field(page, "Seconds (optional)")).toHaveValue("1");
    await expect(background).toBeEnabled();
    await expect(background).toBeChecked();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator("[data-job-ref]")).toHaveAttribute("data-job-ref", /\/jobs\//, {
      timeout: 15_000,
    });
  });
}

test("#25 the technical reason is in the Developer section", async ({ page }) => {
  await open(page, "instrument-updated");
  await connectTyped(page);
  await openProcess(page, "Slow process");
  await page.getByRole("checkbox", { name: "Run in the background" }).check();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("developer-note")).toContainText("Location header", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("developer-note")).toContainText("finding 0039");
});

/** Where focus is: in the open panel, nowhere (the browser's own controls), or in the page behind. */
async function focusIn(page: Page): Promise<"panel" | "nowhere" | "page"> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return "nowhere";
    return active.closest(".side-panel[data-open='true']") === null ? "page" : "panel";
  });
}

for (const style of STYLES) {
  test(`#35 an open panel holds Tab, closes on Escape and on a press beside it (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    const rail = page.getByRole("button", { name: "Jobs", exact: true });
    const jobs = page.getByRole("dialog", { name: "My jobs" });

    await rail.click();
    await expect(jobs).toBeVisible();
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab");
      expect(await focusIn(page)).not.toBe("page");
    }
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusIn(page)).not.toBe("page");
    }
    // Escape from wherever focus is, and focus back on the rail's button.
    await page.locator("body").focus();
    await page.keyboard.press("Escape");
    await expect(jobs).toBeHidden();
    await expect(rail).toBeFocused();

    // A press on what the panel covers closes it, and opens nothing.
    await rail.click();
    await expect(jobs).toBeVisible();
    const behind = await page
      .getByRole("button", { name: "Hello World", exact: true })
      .boundingBox();
    if (behind === null) throw new Error("no Hello World row");
    // Its row reaches past the panel's edge: pressed there, on what the panel dims.
    const row = await page.locator(".process-list li").first().boundingBox();
    if (row === null) throw new Error("no row");
    await page.mouse.click(row.x + row.width - 12, behind.y + behind.height / 2);
    await expect(jobs).toBeHidden();
    await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
  });

  test(`#35 Appearance closes when focus leaves it (${style})`, async ({ page }) => {
    await open(page, style);
    const button = page.getByRole("button", { name: "Appearance", exact: true });
    await button.click();
    const popover = page.getByRole("dialog", { name: "Appearance" });
    await expect(popover).toBeVisible();
    // Out of its last group, onwards: closed, focus where it went.
    await page.getByRole("radio", { name: "Follow system" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(popover).toBeHidden();
    await expect(button).not.toBeFocused();
  });
}

test("#35 opening a process from a panel closes it, and so does Back", async ({ page }) => {
  const SERVICE = "https://pygeoapi.example.test";
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        relay: null,
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
        ],
      }),
    }),
  );
  await page.route(`${SERVICE}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(SERVICE, PYGEOAPI) });
    await route.fulfill({ response });
  });
  await open(page, "instrument-updated");
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();

  // Opening a process from the Examples panel: the panel closes.
  const examples = page.getByRole("dialog", { name: "Examples" });
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await expect(examples).toBeVisible();
  await examples.getByRole("button", { name: "Hello World" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Hello World" })).toBeVisible();
  await expect(examples).toBeHidden();

  // Back to the list with the browser's Back while About is open: it closes.
  const about = page.getByRole("dialog", { name: "About" });
  await page.getByRole("button", { name: "About", exact: true }).click();
  await expect(about).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
  await expect(about).toBeHidden();
});

for (const { style, more, spared } of [
  { style: "instrument-updated", more: "", spared: true },
  { style: "instrument-updated", more: "&developer", spared: false },
  { style: "instrument", more: "", spared: false },
] as const) {
  test(`#43 the technical words are ${spared ? "spared" : "shown"}: ${style}${more}`, async ({
    page,
  }) => {
    await open(page, style, more);
    const shown = async (locator: ReturnType<Page["locator"]>) => {
      if (spared) await expect(locator).toBeHidden();
      else await expect(locator).toBeVisible();
    };
    // The relay/direct tags on the start screen.
    await shown(page.locator(".choice-access").first());

    await connectTyped(page);
    // The service's access, jobs and standard; its process count stays.
    await shown(page.locator(".service-facts .fact-standard"));
    await expect(page.locator(".service-facts .fact-processes")).toBeVisible();
    // How each process runs.
    await shown(page.locator(".cell-runs").first());

    // The request header behind "Run in the background", and a box's CRS.
    await openProcess(page, "Bounding box to feature");
    await shown(page.locator(".run-hint"));
    await expect(
      page.getByText(spared ? "In longitude and latitude." : /^Coordinate reference system: /),
    ).toBeVisible();
  });
}

const TWO_PLOTS = {
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
            [5.38, 52.165],
            [5.38, 52.16],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { name: "Plot, south" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [5.38, 52.15],
            [5.385, 52.15],
            [5.385, 52.155],
            [5.38, 52.155],
            [5.38, 52.15],
          ],
        ],
      },
    },
  ],
};

for (const style of STYLES) {
  test(`#26 a CSV result is a table, and downloads as .csv (${style})`, async ({ page }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Area of each feature");
    await page.getByRole("textbox", { name: "Value (JSON)" }).fill(JSON.stringify(TWO_PLOTS));
    await page.getByRole("button", { name: "Run", exact: true }).click();

    const table = page.locator('[data-output-id="table"]');
    await expect(table.getByRole("region", { name: "Table “table”" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(table.getByRole("columnheader", { name: "area_m2" })).toBeVisible();
    await expect(table.getByRole("cell", { name: "Plot, north" })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      table.getByRole("button", { name: /^Download/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("breinstein-feature-area-table.csv");
  });
}

test("#35 My jobs stays open while a followed job finishes", async ({ page }) => {
  await requireService(`${RELAY}/healthz`, "the relay");
  await open(page, "instrument-updated");
  await page.getByRole("radio", { name: /^pygeoapi[- ]cors /i }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await openProcess(page, "Slow process");
  await field(page, "Seconds (optional)").fill("3");
  await page.getByRole("checkbox", { name: "Run in the background" }).check();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("[data-job-ref]")).toHaveAttribute("data-job-ref", /\/jobs\//, {
    timeout: 15_000,
  });

  const jobs = page.getByRole("dialog", { name: "My jobs" });
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(jobs).toBeVisible();
  // The job finishes behind the panel: its results arrive, the panel stays.
  await expect(page.locator('[data-output-id="slept"]')).toBeAttached({ timeout: 30_000 });
  await expect(jobs).toBeVisible();
  await expect(jobs.locator("[data-job-status]")).toHaveAttribute("data-job-status", "successful");
});
