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
/** A 1×1 transparent PNG: a tile, as far as the map is concerned. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

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

    test(`at night the map is ${updated ? "grey" : "the standard one"}; by day the standard one`, async ({
      page,
    }) => {
      // Tiles answered here, counted by variant: the test needs no network.
      const asked = { standaard: 0, grijs: 0 };
      await page.route("https://service.pdok.nl/kadaster/brt-achtergrondkaart/**", (route) => {
        const variant = /\/v2_0\/(\w+)\//.exec(route.request().url())?.[1];
        if (variant === "standaard" || variant === "grijs") asked[variant] += 1;
        return route.fulfill({ contentType: "image/png", body: PIXEL });
      });
      await open(page, style);
      await connect(page);
      await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
      await page.locator(".map-pane canvas").waitFor();
      await expect.poll(() => asked.standaard).toBeGreaterThan(0);
      expect(asked.grijs).toBe(0);

      await page.getByRole("banner").getByRole("button", { name: "Appearance" }).click();
      await page
        .getByRole("dialog", { name: "Appearance" })
        .getByRole("radio", { name: "On" })
        .check();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      if (updated) await expect.poll(() => asked.grijs).toBeGreaterThan(0);
      else {
        await page.waitForTimeout(1000);
        expect(asked.grijs).toBe(0);
      }
    });
  });
}
