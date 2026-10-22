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

async function open(page: Page, style: string) {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  await page.goto(`/?style=${style}&theme=light`);
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

/** Connect through the relay's configured endpoint, which background runs need. */
async function connectConfigured(page: Page) {
  await page.getByRole("radio", { name: /^pygeoapi-cors / }).check();
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

// The relay, for the tests that run in the background.
export { RELAY, connectConfigured };
