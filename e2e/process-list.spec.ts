/**
 * The process list's search: the count says how many of the list match, and
 * a search that finds nothing says so instead of showing an empty table.
 * The local pygeoapi lists enough processes for the search box to show.
 */

import { expect, test } from "./fixtures.js";
import { requireService } from "./services.js";
import { CONNECTED } from "./waits.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";

test.beforeEach(async ({ page }) => {
  await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
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
    const response = await route.fetch({ url: route.request().url().replace(SERVICE, PYGEOAPI) });
    await route.fulfill({ response });
  });
});

test("the count follows the search, and no match is said in words", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible(
    CONNECTED,
  );

  const count = page.locator(".list-count");
  const listed = Number(/^(\d+) processes/.exec((await count.textContent()) ?? "")?.[1]);
  expect(listed).toBeGreaterThan(8);

  const search = page.getByRole("searchbox", { name: "Search processes" });
  await search.fill("hello");
  await expect(count).toHaveText(`1 of ${String(listed)} processes.`);
  await expect(page.locator(".process-list > li")).toHaveCount(1);

  await search.fill("no such process");
  await expect(count).toHaveText(`0 of ${String(listed)} processes.`);
  await expect(page.locator(".list-empty")).toHaveText("No processes match “no such process”.");
  await expect(page.locator(".process-table")).toHaveCount(0);

  // Every word, in any order (#9).
  await search.fill("world HELLO");
  await expect(count).toHaveText(`1 of ${String(listed)} processes.`);

  await search.fill("no such process");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(count).toHaveText(`${String(listed)} processes.`);
});
