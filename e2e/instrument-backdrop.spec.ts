/**
 * Europe behind Instrument's start screen: the theme picks the picture, a
 * page loads only the one it shows, the other styles load neither, and both
 * come from this site. Never from NASA's or Wikimedia's servers: the pictures
 * are committed, and the page must not hand a visitor's address to anyone.
 */

import { expect, test, type Page } from "@playwright/test";

const DAY = /europe-day[^/]*\.webp$/;
const NIGHT = /europe-night[^/]*\.webp$/;
const THIRD_PARTY = /(^|\.)(nasa\.gov|wikimedia\.org|wikipedia\.org)$/;

/** Every address the page asks for, from before it loads. */
function requests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    seen.push(request.url());
  });
  return seen;
}

async function open(page: Page, query: string) {
  // No services and no examples: the start screen alone.
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ relay: null, presets: [], examples: [] }),
    }),
  );
  await page.goto(`/?${query}`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

/** Two frames: long enough for a background that applies to be asked for. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

function expectNoThirdParty(seen: string[]) {
  const hosts = seen.map((url) => new URL(url).hostname);
  expect(hosts.filter((host) => THIRD_PARTY.test(host))).toEqual([]);
}

test("instrument light shows Europe by day, and switching to dark loads the night", async ({
  page,
}) => {
  const seen = requests(page);
  const day = page.waitForRequest(DAY);
  await open(page, "style=instrument&theme=light");
  await day;
  await settle(page);
  expect(seen.filter((url) => NIGHT.test(url))).toEqual([]);

  const night = page.waitForRequest(NIGHT);
  await page.getByRole("banner").getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("dialog", { name: "Appearance" }).getByRole("radio", { name: "On" }).check();
  await night;
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  expectNoThirdParty(seen);
});

for (const style of ["hybrid", "precise"]) {
  for (const theme of ["light", "dark"]) {
    test(`${style} ${theme} keeps its streets and loads neither picture`, async ({ page }) => {
      const seen = requests(page);
      await open(page, `style=${style}&theme=${theme}`);
      await settle(page);
      expect(seen.filter((url) => DAY.test(url) || NIGHT.test(url))).toEqual([]);
      expectNoThirdParty(seen);
    });
  }
}
