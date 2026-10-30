/**
 * The keyboard's and the screen reader's way through the page, in both
 * versions of Instrument: a skip link past the rail, an address error said
 * and put right where it is, focus on the first input in error after a Run
 * the form refused, and a wordmark that is never a label without a link.
 *
 * `config.json` allows https: services only, so the example names a test
 * address, which this spec answers from the local pygeoapi.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";

async function open(page: Page, style: string) {
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
          {
            service: SERVICE,
            process: "slow",
            title: "Slow process",
            summary: "Waits a number of seconds.",
            needs: "values",
            featured: false,
          },
        ],
      }),
    }),
  );
  await page.route(`${SERVICE}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(SERVICE, PYGEOAPI) });
    await route.fulfill({ response });
  });
  await page.goto(`/?style=${style}&theme=light`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

for (const style of ["instrument", "instrument-updated"]) {
  test.describe(style, () => {
    test.beforeEach(async () => {
      await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
    });

    test("the first Tab lands on a skip link, which goes past the rail", async ({ page }) => {
      await open(page, style);
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.locator("main#content")).toBeFocused();
    });

    test("an address that isn't one is said, and focus goes back to it", async ({ page }) => {
      await open(page, style);
      const address = page.getByRole("textbox", { name: "Service address" });
      await address.fill("not a url");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Enter the full address of a service");
      await expect(address).toBeFocused();
      await expect(address).toHaveAttribute("aria-invalid", "true");
      // Where Connect goes is never the half-typed word.
      await expect(page.locator(".connect-target")).toHaveText("the address you type");
    });

    test("a Run the form refuses puts focus on the first input in error", async ({ page }) => {
      await open(page, style);
      await page.getByRole("button", { name: "Hello World" }).click();
      await page.getByRole("button", { name: "Run", exact: true }).click();
      const name = page.getByRole("textbox", { name: /Name/ });
      await expect(name).toBeFocused();
      await expect(name).toHaveAttribute("aria-invalid", "true");
    });

    test("the wordmark is a named link, and during a run neither link nor label", async ({
      page,
    }) => {
      await open(page, style);
      const logo = page.locator(".rail-logo");
      await expect(logo).toHaveAttribute("aria-label", /start$/);
      await page.getByRole("banner").getByRole("button", { name: "Examples" }).click();
      await page.getByRole("button", { name: "Slow process" }).click();
      await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("3");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      // Under way: Start can't be used, and neither can the wordmark.
      await expect(page.getByRole("banner").getByRole("button", { name: "Start" })).toBeDisabled();
      await expect(logo).not.toHaveAttribute("href");
      await expect(logo).not.toHaveAttribute("aria-label");
      await expect(logo).toHaveAttribute("aria-hidden", "true");
    });
  });
}
