/**
 * Examples (config.json `examples`): one click connects to the example's
 * service and opens its process; an example naming a process the service does
 * not list lands on the list with a notice; "Browse all" lists every example.
 *
 * `config.json` allows https: services only, so the examples name one on a
 * test address, and this spec answers that address from the local pygeoapi.
 * Skips when pygeoapi is not answering, as the other browser specs do.
 */

import { expect, test, type Page } from "@playwright/test";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";

/** The page with these examples in its config.json, and SERVICE answered by pygeoapi. */
async function withExamples(page: Page, examples: readonly Record<string, unknown>[]) {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ relay: null, presets: [], examples }),
    }),
  );
  await page.route(`${SERVICE}/**`, async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace(SERVICE, PYGEOAPI),
    });
    await route.fulfill({ response });
  });
}

const hello = {
  service: SERVICE,
  process: "hello-world",
  title: "Hello World",
  summary: "Type a name; the service greets it back.",
  needs: "values",
  featured: true,
};

test.describe("examples", () => {
  test.beforeEach(async () => {
    await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
  });

  test("a featured example connects to its service and opens its process", async ({ page }) => {
    await withExamples(page, [hello]);
    await page.goto("/");
    await page.getByRole("button", { name: "Hello World" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "Hello World" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
    // The ordinary flow from here: back to the service's list.
    await page.getByRole("button", { name: /All processes/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
  });

  test("an example the service does not list lands on the list with a notice", async ({ page }) => {
    await withExamples(page, [
      { ...hello, process: "breinstein-gone", title: "Gone", summary: "Not there." },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Gone" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "no process called" })).toHaveText(
      /This service has no process called breinstein-gone\./,
    );
  });

  test("Browse all lists every example, searched and filtered", async ({ page }) => {
    await withExamples(page, [
      hello,
      {
        service: SERVICE,
        process: "breinstein-buildings",
        title: "Buildings in an area",
        summary: "Draw a shape; get the buildings inside it.",
        needs: "area",
      },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: /Browse all 2 examples/ }).click();

    const panel = page.getByRole("complementary", { name: "Examples" });
    await expect(panel.getByRole("heading", { name: "Examples" })).toBeFocused();
    await panel.getByRole("button", { name: "Draw an area" }).click();
    await expect(panel.getByRole("button", { name: "Buildings in an area" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Hello World" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: /Browse all 2 examples/ })).toBeFocused();
  });
});
