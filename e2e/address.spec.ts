/**
 * The page's place in its address: a reload comes back to it, Back and
 * Forward move between the places visited, and a link names one, which the
 * user still connects to themselves. Leaving with something typed is asked
 * about first. In both versions of Instrument: the address is not a style.
 *
 * `config.json` allows https: services only, so the preset names a test
 * address, which this spec answers from the local pygeoapi.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { requireService } from "./services.js";
import { CONNECTED } from "./waits.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";

/** Everything asked of the test service, by path. */
async function prepare(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        relay: null,
        presets: [{ title: "Reference pygeoapi", url: SERVICE }],
        examples: [],
      }),
    }),
  );
  await page.route(`${SERVICE}/**`, async (route) => {
    asked.push(new URL(route.request().url()).pathname);
    const response = await route.fetch({ url: route.request().url().replace(SERVICE, PYGEOAPI) });
    await route.fulfill({ response });
  });
  return asked;
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });

for (const style of ["instrument", "instrument-updated"]) {
  test.describe(style, () => {
    test.beforeEach(async () => {
      await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
    });

    test("the address follows the page; reload, Back and Forward go where it says", async ({
      page,
    }) => {
      await prepare(page);
      await page.goto(`/?style=${style}&theme=dark`);
      await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(heading(page, "Processes")).toBeVisible(CONNECTED);
      // The appearance parameters stay; the place is added beside them.
      await expect(page).toHaveURL(
        new RegExp(`\\?style=${style}&theme=dark&service=${encodeURIComponent(SERVICE)}$`),
      );

      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await expect(heading(page, "Hello World")).toBeVisible();
      await expect(page).toHaveURL(/&process=hello-world$/);

      // A reload comes back to the process, through the same connection.
      await page.reload();
      await expect(heading(page, "Hello World")).toBeVisible();

      await page.goBack();
      await expect(heading(page, "Processes")).toBeVisible();
      await page.goBack();
      await expect(heading(page, "Connect to a service")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`\\?style=${style}&theme=dark$`));
      await page.goForward();
      await expect(heading(page, "Processes")).toBeVisible();
      await page.goForward();
      await expect(heading(page, "Hello World")).toBeVisible();
    });

    test("a link fills in the place, and nothing is asked of the service until Connect", async ({
      page,
    }) => {
      const asked = await prepare(page);
      await page.goto(
        `/?style=${style}&service=${encodeURIComponent(SERVICE)}&process=hello-world`,
      );
      await expect(heading(page, "Connect to a service")).toBeVisible();
      await expect(page.getByTestId("link-notice")).toContainText(
        `This link opens ${SERVICE}, process hello-world.`,
      );
      await expect(page.getByRole("radio", { name: /Reference pygeoapi/ })).toBeChecked();
      await page.waitForTimeout(500);
      expect(asked).toEqual([]);

      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(heading(page, "Hello World")).toBeVisible(CONNECTED);
      expect(asked.length).toBeGreaterThan(0);
    });

    test("leaving a form with something typed is asked about; an untouched one is not", async ({
      page,
    }) => {
      await prepare(page);
      await page.goto(`/?style=${style}`);
      await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await expect(heading(page, "Hello World")).toBeVisible(CONNECTED);

      const asksBeforeLeaving = () =>
        page.evaluate(() => {
          const event = new Event("beforeunload", { cancelable: true });
          globalThis.dispatchEvent(event);
          return event.defaultPrevented;
        });
      expect(await asksBeforeLeaving()).toBe(false);
      await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
      await expect.poll(asksBeforeLeaving).toBe(true);
    });
  });
}
