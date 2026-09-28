/**
 * The static site: the production build with `config.json` saying there is no
 * relay, exactly as it is hosted. The page must work straight from the
 * browser — connect, describe, run synchronously — against the pygeoapi that
 * sends CORS headers, and must send nothing at all to a relay: not to the one
 * this lane runs on :8787, and not to a relay path on its own site.
 *
 * The same build serves the relay specs, with `e2e/config.relay.json`; this
 * spec answers `/config.json` itself.
 */

import { expect, test } from "@playwright/test";

const PYGEOAPI = "http://localhost:5080";
const RELAY = "http://localhost:8787";
/** The relay's routes, anywhere, and the path the static site keeps free for it. */
const RELAY_PATH = /^\/(api|endpoints|sessions|execute|read|callbacks)(\/|$)/;

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

test.describe("the static site, without a relay", () => {
  test.beforeEach(async () => {
    test.skip(!(await answering(`${PYGEOAPI}/?f=json`)), "pygeoapi :5080 is not answering");
  });

  test("connects, describes and runs synchronously, and sends nothing to a relay", async ({
    page,
  }) => {
    const relayRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === RELAY || RELAY_PATH.test(url.pathname)) relayRequests.push(request.url());
    });
    await page.route("**/config.json", (route) =>
      route.fulfill({ contentType: "application/json", body: '{"relay":null,"presets":[]}' }),
    );

    await page.goto("/");
    await expect(page.getByTestId("static-only")).toContainText("without the relay");
    await expect(page.getByTestId("config-warning")).toHaveCount(0);

    await page.getByRole("textbox", { name: "Service address" }).fill(PYGEOAPI);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "Hello World", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Hello World" })).toBeVisible();

    await page.getByRole("textbox", { name: "Name (required)" }).fill("static site");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator('[data-output-id="echo"]')).toContainText("Hello static site", {
      timeout: 15_000,
    });

    await page.locator("details.developer > summary").click();
    await expect(page.getByTestId("relay-state")).toContainText("off");
    expect(relayRequests).toEqual([]);
  });

  test("a missing config.json falls back to static-only, and says so", async ({ page }) => {
    const relayRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === RELAY || RELAY_PATH.test(url.pathname)) relayRequests.push(request.url());
    });
    await page.route("**/config.json", (route) => route.fulfill({ status: 404, body: "" }));

    await page.goto("/");
    await expect(page.getByTestId("config-warning")).toContainText("missing");
    await expect(page.getByTestId("static-only")).toBeVisible();
    expect(relayRequests).toEqual([]);
  });
});
