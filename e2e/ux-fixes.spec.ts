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
    // With the Developer section, where the record is read (#38).
    await open(page, style, "&developer");
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
  await open(page, "instrument-updated", "&developer");
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

for (const style of STYLES) {
  test(`#11 the input the service's error names is marked, and has the focus (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Buildings in an area");
    await page.route("**/processes/breinstein-buildings/execution**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          type: "InvalidParameterValue",
          description: 'The "area" input is 3738 m across; at most 1000 m is searched',
        }),
      }),
    );
    const area = page.getByRole("textbox", { name: "GeoJSON", exact: true });
    await area.fill(
      '{"type":"Polygon","coordinates":[[[4.885,52.36],[4.94,52.36],[4.94,52.38],[4.885,52.38],[4.885,52.36]]]}',
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();

    await expect(page.getByRole("alert").first()).toContainText(
      "The service reported an error. Check the input “Area” and run again.",
    );
    await expect(area).toHaveAttribute("aria-invalid", "true");
    await expect(area).toBeFocused();
    await expect(page.locator(".field.has-error")).toContainText(
      'The "area" input is 3738 m across; at most 1000 m is searched',
    );
    // Changed, it is no longer the input in error.
    await area.fill("");
    await expect(area).not.toHaveAttribute("aria-invalid", "true");
  });
}

test("#12 a date-time is made from a date, a time and an offset, and typed ones are checked", async ({
  page,
}) => {
  await open(page, "instrument");
  await connectTyped(page);
  await openProcess(page, "Dates and times");
  await page.getByRole("textbox", { name: "Day (required)" }).fill("2026-11-03");
  await page.getByLabel("Time", { exact: true }).fill("09:00");
  await page.getByRole("textbox", { name: "Moment (optional) Date" }).fill("2026-11-03");
  await page.getByLabel("Offset from UTC").selectOption("+01:00");
  const request = page.waitForRequest(
    (candidate) => candidate.method() === "POST" && candidate.url().includes("/breinstein-dates/"),
  );
  await page.getByRole("button", { name: "Run", exact: true }).click();
  expect(((await request).postDataJSON() as { inputs: unknown }).inputs).toEqual({
    day: "2026-11-03",
    moment: "2026-11-03T09:00:00+01:00",
  });
  await expect(page.locator('[data-output-id="understood"]')).toContainText(
    '"utc": "2026-11-03T08:00:00Z"',
  );

  // Typed, it is checked before anything is sent.
  await page.getByRole("button", { name: "Change the inputs" }).click();
  await page.getByRole("button", { name: "Type it instead" }).click();
  const typed = page.getByRole("textbox", { name: "Moment (optional)" });
  await typed.fill("21-10-2026 14:30");
  let sent = false;
  page.on("request", (candidate) => {
    if (candidate.method() === "POST" && candidate.url().includes("/breinstein-dates/"))
      sent = true;
  });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".field.has-error")).toContainText(
    "Give a date and time with its offset from UTC, such as 2026-10-21T14:30:00+02:00",
  );
  await expect(typed).toBeFocused();
  expect(sent).toBe(false);
});

test("#30 the Jobs badge leaves out a finished job the page is still confirming", async ({
  page,
}) => {
  await requireService(`${RELAY}/healthz`, "the relay");
  // The page reads "successful" while the job really runs on: no success
  // callback can have been delivered yet, so the page goes on confirming it.
  await page.route(
    (url) => url.origin === PYGEOAPI && /^\/jobs\/[^/]+$/.test(url.pathname),
    async (route) => {
      const response = await route.fetch();
      const body: unknown = await response.json();
      const job = typeof body === "object" && body !== null ? body : {};
      await route.fulfill({ response, json: { ...job, status: "successful", progress: 100 } });
    },
  );
  await open(page, "instrument");
  await page.getByRole("radio", { name: /^pygeoapi[- ]cors /i }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await openProcess(page, "Slow process");
  await field(page, "Seconds (optional)").fill("20");
  await page.getByRole("checkbox", { name: "Run in the background" }).check();
  await page.getByRole("button", { name: "Run", exact: true }).click();

  await page.getByRole("button", { name: /^Jobs/ }).click();
  const row = page.getByTestId("my-jobs").locator("[data-job-row]");
  await expect(row.locator("[data-job-status]")).toHaveAttribute("data-job-status", "successful", {
    timeout: 15_000,
  });
  await expect(row.locator("[data-not-yet-confirmed]")).toBeVisible();
  // Done, and still being confirmed: not counted as running.
  await expect(page.getByRole("button", { name: /^Jobs/ }).locator(".badge")).toHaveCount(0);
});

for (const style of STYLES) {
  test(`#31 Cancel job asks first, and the job then says it was cancelled by you (${style})`, async ({
    page,
  }) => {
    await requireService(`${RELAY}/healthz`, "the relay");
    await open(page, style);
    await page.getByRole("radio", { name: /^pygeoapi[- ]cors /i }).check();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await openProcess(page, "Slow process");
    await field(page, "Seconds (optional)").fill("60");
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const running = page.locator("[data-job-ref]");
    await expect(running).toHaveAttribute("data-job-ref", /\/jobs\//, { timeout: 15_000 });

    // Asked, and kept: nothing sent.
    let deletes = 0;
    page.on("request", (request) => {
      if (request.method() === "DELETE") deletes += 1;
    });
    await page.getByRole("button", { name: "Cancel job" }).click();
    const question = page.getByRole("group", { name: "Confirm cancelling" });
    await expect(question).toContainText("Cancel this job on the server?");
    await expect(question.getByRole("button", { name: "Keep job" })).toBeFocused();
    await question.getByRole("button", { name: "Keep job" }).click();
    await expect(question).toBeHidden();
    expect(deletes).toBe(0);

    // Asked, and answered: cancelled.
    await page.getByRole("button", { name: "Cancel job" }).click();
    await question.getByRole("button", { name: "Cancel job" }).click();
    await expect(page.getByText("Job cancelled. The server has dismissed it.")).toBeVisible();
    await page.getByRole("button", { name: /^Jobs/ }).click();
    const row = page.getByTestId("my-jobs").locator("[data-job-row]");
    await expect(row.locator('[data-job-status="cancelled-by-you"]')).toBeVisible();
    await expect(row).not.toContainText("gone");
    await expect(row).not.toContainText("No longer");
  });
}

test("#32 a job followed by its link can't be cancelled, and is listed apart", async ({
  page,
  browser,
}) => {
  await requireService(`${RELAY}/healthz`, "the relay");
  await open(page, "instrument-updated");
  await page.getByRole("radio", { name: /^pygeoapi[- ]cors /i }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await openProcess(page, "Slow process");
  await field(page, "Seconds (optional)").fill("60");
  await page.getByRole("checkbox", { name: "Run in the background" }).check();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const link = await page.getByRole("textbox", { name: "The job’s link" }).inputValue();

  // Someone else, in another browser, opens the link.
  const other = await browser.newContext();
  const elsewhere = await other.newPage();
  await elsewhere.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  await elsewhere.goto(link);
  await elsewhere.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(elsewhere.locator("[data-job-ref]")).toHaveAttribute("data-job-ref", /\/jobs\//, {
    timeout: 15_000,
  });
  await expect(elsewhere.getByRole("button", { name: "Cancel job" })).toHaveCount(0);
  await elsewhere.getByRole("button", { name: /^Jobs/ }).click();
  const panel = elsewhere.getByRole("dialog", { name: "My jobs" });
  await expect(panel.getByRole("heading", { name: "Jobs you followed by link" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Run again|^Open the process/ })).toHaveCount(0);
  await other.close();

  // The browser that started it can still cancel it.
  await expect(page.getByRole("button", { name: "Cancel job" })).toBeVisible();
});

for (const style of STYLES) {
  test(`#19 a pasted shape is brought into view once it parses (${style})`, async ({ page }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Rotate a polygon a quarter turn");
    const canvas = page.locator(".map-canvas");
    await expect(canvas).toHaveAttribute("data-view", /./, { timeout: 15_000 });
    const before = (await canvas.getAttribute("data-view")) ?? "";

    // Barcelona, far from where the map starts.
    const box = page.getByRole("textbox", { name: "GeoJSON", exact: true });
    await box.fill('{"type":"Polygon","coordinates":[[[2.15,41.38],[2.19,41.38],[2.19,41.4]');
    await page.waitForTimeout(800);
    // Half typed: nothing to show, so the map stays.
    expect(await canvas.getAttribute("data-view")).toBe(before);
    await box.fill(
      '{"type":"Polygon","coordinates":[[[2.15,41.38],[2.19,41.38],[2.19,41.4],[2.15,41.38]]]}',
    );
    await expect
      .poll(async () => Number(((await canvas.getAttribute("data-view")) ?? "0").split(",")[0]), {
        timeout: 5_000,
      })
      .toBeCloseTo(2.17, 1);
  });
}

for (const style of STYLES) {
  test(`#18 the drawing tools come right after Draw, and the map's view can be the input (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Rotate a polygon a quarter turn");
    await page.locator(".map-pane canvas").waitFor();
    await expect(page.getByText("Drawing needs a mouse or touch.")).toBeVisible();

    // Draw: the first tool has the focus, the next Tab is the next tool.
    await page.getByRole("button", { name: "Draw on the map" }).click();
    const tools = page.getByRole("toolbar", { name: "Drawing tools" });
    await expect(tools.getByRole("button", { name: "Add area" })).toBeFocused();
    await expect(tools.getByRole("button", { name: "Add area" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Tab");
    await expect(tools.getByRole("button", { name: "Add box" })).toBeFocused();
    await page.getByRole("button", { name: "Stop drawing" }).click();

    // The map's view, as the area.
    await page.getByRole("button", { name: "Use the current map view" }).click();
    const geojson = page.getByRole("textbox", { name: "GeoJSON", exact: true });
    await expect(geojson).toHaveValue(/"Polygon"/);
    const value: unknown = JSON.parse(await geojson.inputValue());
    expect(value).toMatchObject({ type: "Polygon" });
    await expect(page.getByTestId("shape-size")).toContainText("km across");

    // And as a box.
    await toList(page);
    await openProcess(page, "Bounding box to feature");
    await page.locator(".map-pane canvas").waitFor();
    await page.getByRole("button", { name: "Use the current map view" }).click();
    await expect(page.getByRole("textbox", { name: /^West/ })).not.toHaveValue("");
    await expect(page.getByTestId("shape-size")).toContainText("km across");
  });
}

test("#36 the form's width can be changed with the keys and by dragging, between 400 and 640px", async ({
  page,
}) => {
  await open(page, "instrument-updated");
  await connectTyped(page);
  await openProcess(page, "Buildings in an area");
  const handle = page.getByRole("separator", { name: "Width of the form" });
  const panel = page.locator("main.panel");
  const width = async () => Math.round((await panel.boundingBox())?.width ?? 0);
  expect(await width()).toBe(400);

  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "432");
  await expect.poll(width).toBe(432);
  await page.keyboard.press("End");
  await expect.poll(width).toBe(640);

  const box = await handle.boundingBox();
  if (box === null) throw new Error("no handle");
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 150, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(width).toBeLessThan(560);

  // Kept for the visit, from one process to the next.
  const kept = await width();
  await toList(page);
  await openProcess(page, "Hello World");
  await expect.poll(width).toBe(kept);
});

for (const style of STYLES) {
  test(`#39 on a phone, drawing brings the map into view with Done and Clear (${style})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Rotate a polygon a quarter turn");
    await page.locator(".map-pane canvas").waitFor();
    const geojson = page.getByRole("textbox", { name: "GeoJSON", exact: true });
    await geojson.fill(
      '{"type":"Polygon","coordinates":[[[5.1,52.1],[5.2,52.1],[5.2,52.2],[5.1,52.1]]]}',
    );
    await page.getByRole("button", { name: "Draw on the map" }).click();

    const bar = page.getByRole("group", { name: "Drawing “Polygon”" });
    await expect(bar).toBeInViewport();
    await expect(page.locator(".map-pane canvas")).toBeInViewport({ ratio: 0.3 });
    // The tools are over the map, where the drawing is.
    await expect(
      page.locator(".map-pane").getByRole("toolbar", { name: "Drawing tools" }),
    ).toBeVisible();

    // Clear empties the field; Done goes back to it.
    await bar.getByRole("button", { name: "Clear" }).click();
    await expect(geojson).toHaveValue("");
    await bar.getByRole("button", { name: "Done" }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Draw on the map" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Draw on the map" })).toBeInViewport();
  });
}

for (const size of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  for (const style of STYLES) {
    const updated = style === "instrument-updated";
    test(`#40 at ${String(size.width)}×${String(size.height)}, the map ${updated ? "is right under the result" : "stays at the foot"} (${style})`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await open(page, style);
      await connectTyped(page);
      await openProcess(page, "Area of each feature");
      await page.getByRole("textbox", { name: "Value (JSON)" }).fill(JSON.stringify(TWO_PLOTS));
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.locator('[data-output-id="table"]')).toBeVisible({ timeout: 30_000 });
      const map = page.locator(".map-pane");
      await expect(map).toHaveCount(1);
      const showOnMap = page.getByRole("button", { name: "Show on the map" });
      if (!updated) {
        await expect(page.locator(".map-slot")).toHaveCount(0);
        await expect(showOnMap).toHaveCount(0);
        return;
      }
      // Under the result, before what was sent.
      await expect(page.locator(".result-block + .map-slot > .map-pane")).toHaveCount(1);
      const [mapBox, sentBox] = await Promise.all([
        map.boundingBox(),
        page.getByTestId("sent-inputs").boundingBox(),
      ]);
      expect((mapBox?.y ?? 0) < (sentBox?.y ?? 0)).toBe(true);
      await showOnMap.click();
      await expect(map).toBeInViewport({ ratio: 0.5 });
      // Still the result: the button is no step in the page's history.
      await expect(page.locator('[data-output-id="table"]')).toBeVisible();
    });
  }
}

for (const style of STYLES) {
  test(`#41 a phone on its side: the rail scrolls to Appearance, and the form has the height (${style})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    // With examples, as a deployment has them: the rail has its Examples item.
    await page.route("**/config.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          relay: null,
          presets: [],
          examples: [
            {
              service: "https://pygeoapi.example.test",
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
    // With the Developer section, which is there with `?developer` in the update (#38).
    await open(page, style, "&developer");
    await connectTyped(page);
    await openProcess(page, "Buildings in an area");
    // Appearance, at the rail's foot, within reach: the rail scrolls to it.
    const appearance = page.getByRole("button", { name: "Appearance", exact: true });
    await page.locator("header.app-rail").evaluate((rail) => {
      rail.scrollTop = rail.scrollHeight;
    });
    await expect(appearance).toBeInViewport({ ratio: 1 });
    await appearance.click();
    await expect(page.getByRole("dialog", { name: "Appearance" })).toBeVisible();
    await page.keyboard.press("Escape");
    // The Developer section scrolls with the form instead of holding its foot.
    const position = await page
      .locator("details.developer")
      .evaluate((element) => getComputedStyle(element).position);
    expect(position).not.toBe("sticky");
  });
}

// Phase 3.

for (const style of STYLES) {
  test(`#7 Tab stays in the relay question: the skip link behind it is inert (${style})`, async ({
    page,
  }) => {
    await requireService(`${RELAY}/healthz`, "the relay");
    await requireService("http://localhost:5081/?f=json", "pygeoapi :5081");
    await open(page, style);
    await page.getByRole("radio", { name: /^pygeoapi[- ]nocors[- ]relay /i }).check();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const offer = page.getByTestId("relay-offer");
    await expect(offer).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".skip-link")).toHaveAttribute("inert", "");
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) return "nowhere";
        return active.closest("[data-testid='relay-offer']") === null ? "page" : "question";
      });
      expect(where).not.toBe("page");
    }
    await page.keyboard.press("Escape");
    await expect(offer).toBeHidden();
    await expect(page.locator(".skip-link")).not.toHaveAttribute("inert", "");
  });
}

test("#37 the tab's title says where the page is", async ({ page }) => {
  await open(page, "instrument");
  await expect(page).toHaveTitle("Connect · Breinstein");
  await connectTyped(page);
  await expect(page).toHaveTitle(/^Processes · \S/);
  const serviceName = (await page.title()).replace(/^Processes · /, "");
  await openProcess(page, "Hello World");
  await expect(page).toHaveTitle(`Hello World · ${serviceName}`);
  await field(page, "Name (required)").fill("Barcelona");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator('[data-output-id="echo"]')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveTitle(`Hello World: result · ${serviceName}`);
  await toList(page);
  await expect(page).toHaveTitle(`Processes · ${serviceName}`);
});

const SEARCHED_EXAMPLES = [
  {
    service: "https://pygeoapi.example.test",
    process: "hello-world",
    title: "Hello World",
    summary: "Type a name; the service greets it back.",
    needs: "values",
    featured: true,
  },
  {
    service: "https://pygeoapi.example.test",
    process: "breinstein-buildings",
    title: "Buildings in an area",
    summary: "Draw an area in Amsterdam; the service lists its buildings.",
    needs: "area",
  },
];

for (const style of STYLES) {
  test(`#9 the examples search finds every word in any order, and says when nothing matches (${style})`, async ({
    page,
  }) => {
    await page.route("**/config.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ relay: null, presets: [], examples: SEARCHED_EXAMPLES }),
      }),
    );
    await open(page, style);
    await page.getByRole("button", { name: "Examples", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Examples" });
    const search = panel.getByRole("searchbox", { name: "Search examples" });
    await search.fill("amsterdam BUILDINGS");
    await expect(panel.locator(".examples-count")).toHaveText("1 example");
    await expect(panel.getByRole("button", { name: /^Buildings in an area/ })).toBeVisible();

    await search.fill("amsterdam hello");
    await expect(panel.locator(".examples-count")).toHaveText("0 examples");
    await expect(panel.locator(".list-empty")).toHaveText("No examples match “amsterdam hello”.");
    await panel.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(panel.locator(".examples-count")).toHaveText("2 examples");
  });
}

for (const style of STYLES) {
  test(`#6 the relay's services stay listed while it is down, and can't be chosen (${style})`, async ({
    page,
  }) => {
    await requireService(`${RELAY}/healthz`, "the relay");
    let relayDown = false;
    await page.route(`${RELAY}/endpoints`, (route) =>
      relayDown ? route.abort("connectionrefused") : route.fallback(),
    );
    await open(page, style);
    // By its key: the updated Instrument names it by its title once read.
    const listed = page.locator("input[type='radio'][value='pygeoapi-cors']");
    await expect(listed).toBeEnabled();

    // The relay goes down; back on the start screen its rows are kept.
    relayDown = true;
    await connectTyped(page);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(listed).toBeDisabled();
    await expect(listed).toHaveAccessibleDescription("Temporarily unavailable");
    await expect(page.getByText("Some services are temporarily unavailable.")).toHaveCount(0);

    // And back up: offered again.
    relayDown = false;
    await connectTyped(page);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(listed).toBeEnabled();
  });
}

test("#6 with the relay down from the start, one line says so", async ({ page }) => {
  await page.route(`${RELAY}/endpoints`, (route) => route.abort("connectionrefused"));
  await open(page, "instrument-updated");
  await expect(page.getByText("Some services are temporarily unavailable.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /^pygeoapi[- ]cors /i })).toHaveCount(0);
});

for (const { style, more, shown } of [
  { style: "instrument-updated", more: "", shown: false },
  { style: "instrument-updated", more: "&developer", shown: true },
  { style: "instrument", more: "", shown: true },
]) {
  test(`#38 the Developer section is ${shown ? "there" : "not there"}: ${style}${more}`, async ({
    page,
  }) => {
    await open(page, style, more);
    await expect(page.locator("details.developer")).toHaveCount(shown ? 1 : 0);
    await connectTyped(page);
    await expect(page.locator("details.developer")).toHaveCount(shown ? 1 : 0);
    await openProcess(page, "Buildings in an area");
    await page.locator(".map-pane canvas").waitFor();
    await expect(page.locator("details.developer")).toHaveCount(shown ? 1 : 0);
    if (style === "instrument-updated" && !shown) {
      // Run has the sheet's foot to itself: no room is kept for a Developer bar.
      const gap = await page.evaluate(() => {
        const panel = document.querySelector("main.panel")?.getBoundingClientRect();
        const run = document.querySelector(".run-bar")?.getBoundingClientRect();
        return panel === undefined || run === undefined
          ? undefined
          : Math.round(panel.bottom - run.bottom);
      });
      expect(gap).toBe(0);
    }
  });
}

for (const style of STYLES) {
  test(`#42 the line over the title ${style === "instrument-updated" ? "never breaks inside the process id" : "is as it was"} (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Area of each feature");
    const pieces = await page.locator(".process-path-id").evaluate((id) => ({
      rects: id.getClientRects().length,
      display: getComputedStyle(id).display,
    }));
    if (style === "instrument-updated") {
      // One piece, on its own line after the service's "/".
      expect(pieces.rects).toBe(1);
    } else {
      expect(pieces.display).toBe("inline");
    }
  });
}

for (const style of STYLES) {
  const updated = style === "instrument-updated";
  test(`#14 the form's details ${updated ? "are tidied" : "are as they were"} (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Every input kind");
    const hint = (id: string) => page.locator(`[data-input-id="${id}"] .hint`);
    // The description says "at most 20 characters" and "from 1 to 10".
    await expect(hint("label")).toHaveCount(updated ? 0 : 1);
    await expect(hint("count")).toHaveCount(updated ? 0 : 1);
    await expect(page.locator('[data-input-id="tags"] .list > .help')).toHaveCount(updated ? 0 : 1);
    // A yes/no box says what a tick means, under the same name.
    const enabled = page.getByRole("checkbox", { name: "Enabled (required)", exact: true });
    await expect(enabled).toHaveCount(1);
    await expect(page.locator('[data-input-id="enabled"] .checkbox-yes')).toHaveCount(
      updated ? 1 : 0,
    );
    if (updated) {
      await page.locator('[data-input-id="enabled"] .checkbox-yes').click();
      await expect(enabled).toBeChecked();
    }
    // The form's small buttons, one size in the update.
    await field(page, "Label (required)").fill("Barcelona");
    const heights = await page
      .locator(".form-body button:not(.copy-button), .clear-form button")
      .evaluateAll((buttons) =>
        buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      );
    expect(heights.length).toBeGreaterThan(4);
    expect(new Set(heights).size === 1).toBe(updated);
  });
}

for (const { style, more } of [
  { style: "instrument", more: "" },
  { style: "instrument-updated", more: "" },
  { style: "instrument-updated", more: "&developer" },
]) {
  const updated = style === "instrument-updated";
  test(`#13 JSON that doesn't parse is said ${updated ? "under its box, in plain words" : "as it was"} (${style}${more})`, async ({
    page,
  }) => {
    await open(page, style, more);
    await connectTyped(page);
    await openProcess(page, "Area of each feature");
    const box = page.getByRole("textbox", { name: "Value (JSON)" });
    await box.fill('{\n\t"type": "FeatureCollection"\n\t"features": []\n}');
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const field = page.locator('[data-input-id="features"]');
    const error = field.locator(".field-error");
    await expect(error).toHaveCount(1);
    if (!updated) {
      await expect(error).toContainText("This is not valid JSON (");
      return;
    }
    await expect(error).toContainText(
      "This isn’t valid JSON: check the quotes and brackets near line 3.",
    );
    // Right under the box, before anything else in the field.
    await expect(field.locator("p:has(textarea) + .json-trouble")).toHaveCount(1);
    await expect(box).toHaveAccessibleDescription(/This isn’t valid JSON/);
    // The parser's own words, for developers only.
    if (more === "") await expect(error).not.toContainText("The parser says:");
    else await expect(error).toContainText("The parser says: Expected ',' or '}'");
  });
}

for (const style of STYLES) {
  test(`#20 a clicked shape's properties open on the side away from the click (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Bounding box to feature");
    const box = [5.1, 52.05, 5.2, 52.12];
    for (const [name, value] of [
      ["West (minimum longitude)", box[0]],
      ["South (minimum latitude)", box[1]],
      ["East (maximum longitude)", box[2]],
      ["North (maximum latitude)", box[3]],
    ] as const) {
      await page.getByRole("textbox", { name }).fill(String(value));
    }
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByTestId("feature-hint")).toBeVisible({ timeout: 15_000 });
    const canvas = page.locator(".map-canvas canvas").first();
    await page.waitForTimeout(800);
    const area = await canvas.boundingBox();
    if (area === null) throw new Error("the map has no size");
    const panel = page.getByTestId("feature-properties");

    // Left of the middle: the properties on the right, and the other way round.
    await page.mouse.click(area.x + area.width * 0.42, area.y + area.height / 2);
    await expect(panel).toHaveAttribute("data-side", "right");
    const right = await panel.boundingBox();
    expect((right?.x ?? 0) > area.x + area.width / 2).toBe(true);
    await panel.getByRole("button", { name: "Close" }).click();
    await page.mouse.click(area.x + area.width * 0.58, area.y + area.height / 2);
    await expect(panel).toHaveAttribute("data-side", "left");
    const left = await panel.boundingBox();
    expect((left?.x ?? 0) + (left?.width ?? 0) < area.x + area.width / 2).toBe(true);
    // A short list, its numbers the Dutch way.
    await expect(panel.locator("dd").first()).toHaveText("5,1; 52,05; 5,2; 52,12");
  });

  test(`#21 the map invites a click only when a shape has properties (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Rotate a polygon a quarter turn");
    await page.getByRole("textbox", { name: "GeoJSON", exact: true }).fill(
      JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [5.1, 52.05],
            [5.2, 52.05],
            [5.2, 52.12],
            [5.1, 52.05],
          ],
        ],
      }),
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByTestId("map-legend")).toContainText("The result", { timeout: 15_000 });
    // A bare geometry: nothing to show for a click.
    await expect(page.getByTestId("feature-hint")).toHaveCount(0);
  });
}

for (const style of STYLES) {
  test(`#22 a point input is called a point on the map, not an outline (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Every input kind");
    const area = page.locator('[data-input-id="area"]');
    await area
      .getByRole("textbox", { name: "GeoJSON", exact: true })
      .fill(JSON.stringify({ type: "Point", coordinates: [5.12, 52.09] }));
    const legend = page.getByTestId("map-legend");
    await expect(legend).toHaveText("The point, not yet sent.");
    await expect(legend.locator(".swatch-input")).toHaveAttribute("data-kind", "point");
    await area.getByRole("textbox", { name: "GeoJSON", exact: true }).fill(
      JSON.stringify({
        type: "LineString",
        coordinates: [
          [5.12, 52.09],
          [5.13, 52.1],
        ],
      }),
    );
    await expect(legend).toHaveText("The line, not yet sent.");
    await expect(legend.locator(".swatch-input")).toHaveAttribute("data-kind", "line");
  });
}

for (const style of STYLES) {
  const updated = style === "instrument-updated";
  test(`#29 a small image ${updated ? "is shown at 128px, sharp, and opens full size" : "is shown at its own size"} (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await connectTyped(page);
    await openProcess(page, "Generated PNG");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const image = page.getByRole("img", { name: "The image result “image”" }).first();
    await expect(image).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBe(16);
    // Its rendered size, without the border.
    expect(await image.evaluate((element: HTMLImageElement) => element.width)).toBe(
      updated ? 128 : 16,
    );
    const opener = page.getByRole("button", { name: "Open “image” full size" });
    await expect(opener).toHaveCount(updated ? 1 : 0);
    if (!updated) return;
    expect(await image.evaluate((element) => getComputedStyle(element).imageRendering)).toBe(
      "pixelated",
    );
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "The image result “image”" });
    await expect(dialog).toBeVisible();
    const large = await dialog.getByRole("img").boundingBox();
    expect(large?.width ?? 0).toBeGreaterThan(400);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}
