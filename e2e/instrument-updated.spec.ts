/**
 * Instrument and its update side by side (ADR 0002): each change the update
 * makes shows in it and not in Instrument as it is.
 *
 * `config.json` allows https: services only, so the preset names a test
 * address, which this spec answers from the local pygeoapi.
 */

import { expect, test, type Page } from "@playwright/test";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";
const VERSIONS = [
  { style: "instrument", updated: false },
  { style: "instrument-updated", updated: true },
] as const;

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

async function connect(page: Page) {
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();
}

const rail = (page: Page, name: string) =>
  page.getByRole("banner").getByRole("button", { name, exact: true });

test.beforeEach(async () => {
  await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
});

for (const { style, updated } of VERSIONS) {
  test.describe(style, () => {
    test(`on a phone, About is ${updated ? "in" : "not in"} the bar`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, style);
      const about = rail(page, "About");
      if (!updated) {
        await expect(about).toBeHidden();
        return;
      }
      await about.click();
      await expect(
        page.getByRole("complementary", { name: "About" }).getByText("Where your requests go"),
      ).toBeVisible();
    });

    test(`an open panel ${updated ? "dims" : "doesn't dim"} the page behind it`, async ({
      page,
    }) => {
      await open(page, style);
      await rail(page, "Examples").click();
      await expect(page.getByRole("complementary", { name: "Examples" })).toBeVisible();
      const wash = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".app-body") ?? document.body, "::after").content,
      );
      expect(wash !== "none" && wash !== "normal").toBe(updated);
    });

    test(`the list ${updated ? "leaves out" : "shows"} columns with nothing in them yet`, async ({
      page,
    }) => {
      await open(page, style);
      await connect(page);
      const heads = page.locator(".process-head .label");
      await expect(heads.filter({ hasText: "Needs" })).toBeVisible({ visible: !updated });
      await expect(heads.filter({ hasText: "This visit" })).toBeVisible({ visible: !updated });

      // Once a process has run, "This visit" has something to say in either.
      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("button", { name: "Choose another process" }).click();
      await expect(heads.filter({ hasText: "This visit" })).toBeVisible();
      await expect(heads.filter({ hasText: "Needs" })).toBeVisible();
    });

    test(`the request log ${updated ? "stays in the column" : "lies over the map"}`, async ({
      page,
    }) => {
      await open(page, style);
      await connect(page);
      await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
      await page.locator(".map-pane canvas").waitFor();
      const position = await page
        .locator(".request-log")
        .evaluate((log) => getComputedStyle(log).position);
      expect(position).toBe(updated ? "static" : "fixed");
    });

    test(`picking a listed service ${updated ? "fills in" : "leaves"} the address`, async ({
      page,
    }) => {
      await open(page, style);
      await expect(page.locator(".start-card .eyebrow")).toBeVisible({ visible: !updated });
      await page.getByRole("radio", { name: /Another service/ }).check();
      await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
      await expect(page.getByRole("textbox", { name: "Service address" })).toHaveValue(
        updated ? SERVICE : "",
      );
    });

    test(`a process without a map ${updated ? "is" : "isn't"} on the picture, credited`, async ({
      page,
    }) => {
      await open(page, style);
      await connect(page);
      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Hello World" })).toBeVisible();
      const picture = await page
        .locator(".layout-single")
        .evaluate((layout) => getComputedStyle(layout).backgroundImage);
      expect(picture.includes("europe-")).toBe(updated);
      await expect(page.locator(".backdrop-credit")).toBeVisible({ visible: updated });
    });

    test(`the requests are ${updated ? "in the developer section" : "under the form"}; inputs and outputs ${updated ? "copy" : "don't copy"}`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await open(page, style);
      await connect(page);
      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await expect(page.locator(".process-screen .request-log")).toHaveCount(updated ? 0 : 1);
      await expect(page.locator("details.developer .request-log")).toHaveCount(updated ? 1 : 0);

      await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("button", { name: "Change the inputs" }).waitFor();
      const copyOutput = page.getByRole("button", { name: "Copy echo" });
      const copyInputs = page.getByRole("button", { name: /^Copy the inputs you sent/ });
      if (!updated) {
        await expect(copyOutput).toHaveCount(0);
        await expect(copyInputs).toHaveCount(0);
        return;
      }
      const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
      await copyOutput.click();
      await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
      expect(await clipboard()).toBe('{\n\t"id": "echo",\n\t"value": "Hello Geonovum!"\n}');
      await copyInputs.click();
      await expect.poll(clipboard).toBe('{\n\t"name": "Geonovum"\n}');
    });
  });
}
