/**
 * Instrument in Breinstein's colours, in both themes: the wordmark is a link
 * to the start screen, and About opens out of the rail like Examples and
 * Jobs, one panel at a time.
 *
 * `config.json` allows https: services only, so the example names a test
 * address, which this spec answers from the local pygeoapi.
 */

import { expect, test, type Page } from "@playwright/test";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";

async function instrument(page: Page, theme: "light" | "dark", query = "") {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        relay: null,
        presets: [],
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
  await page.goto(`/?style=instrument&theme=${theme}${query}`);
}

const rail = (page: Page, name: string) =>
  page.getByRole("banner").getByRole("button", { name, exact: true });

for (const theme of ["light", "dark"] as const) {
  test.describe(`instrument, ${theme}`, () => {
    test.beforeEach(async () => {
      await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
    });

    test("the wordmark is a link to the start screen", async ({ page }) => {
      await instrument(page, theme);
      const logo = page.getByRole("link", { name: "Breinstein · OGC API Processes client, start" });
      await expect(logo).toHaveAttribute("href", "/");

      await page.getByRole("button", { name: "Hello World" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Hello World" })).toBeVisible();
      await logo.click();
      await expect(
        page.getByRole("heading", { level: 2, name: "Connect to a service" }),
      ).toBeVisible();
    });

    test("About opens from the rail, and Escape closes it and gives focus back", async ({
      page,
    }) => {
      await instrument(page, theme);
      const about = rail(page, "About");
      await about.click();
      const panel = page.getByRole("complementary", { name: "About" });
      await expect(panel.getByRole("heading", { level: 2, name: "About" })).toBeFocused();
      await expect(about).toHaveAttribute("aria-expanded", "true");
      // Nothing left of the designs' placeholders.
      await expect(panel).not.toContainText("[");

      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(about).toBeFocused();
    });

    test("one panel at a time: About closes Examples and Jobs, and they close About", async ({
      page,
    }) => {
      await instrument(page, theme);
      const about = page.getByRole("complementary", { name: "About" });
      const examples = page.getByRole("complementary", { name: "Examples" });
      const jobs = page.getByRole("complementary", { name: "My jobs" });

      await rail(page, "Examples").click();
      await expect(examples).toBeVisible();
      await rail(page, "About").click();
      await expect(about).toBeVisible();
      await expect(examples).toBeHidden();

      await rail(page, "Jobs").click();
      await expect(jobs).toBeVisible();
      await expect(about).toBeHidden();

      await rail(page, "About").click();
      await expect(about).toBeVisible();
      await expect(jobs).toBeHidden();
    });
  });
}
