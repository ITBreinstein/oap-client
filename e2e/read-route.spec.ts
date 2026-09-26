/**
 * The relay's read route in a browser (phase 3; findings 0049, 0050), against
 * the pinned pygeoapi. This spec runs in the blocking lane; ZOO's version of it
 * is in zoo-browser.spec.ts, which never blocks.
 *
 * `:5081` sends no CORS headers. The relay's CI config lists it twice:
 * `pygeoapi-nocors`, direct-only, which must keep failing with no offer, and
 * `pygeoapi-nocors-relay`, which may be read through the relay once the user
 * says so. `:5080` sends CORS headers and must never be offered anything.
 *
 * What these tests hold:
 *
 * - the page always tries the server directly first;
 * - the relay is offered only after a CORS failure, only where it is
 *   configured, and nothing goes through it until the user clicks;
 * - the banner stays for as long as the relay is in use;
 * - every attempt leaves one `endpoint-access` record, with the direct
 *   failure on it even when the relay then worked.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";
const RELAY = "http://localhost:8787";

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

async function connectConfigured(page: Page, key: string) {
  await page.goto("/");
  await page.getByRole("radio", { name: new RegExp(`^${key} `) }).check();
  await page.getByRole("button", { name: "Connect" }).click();
}

async function exportedObservations(
  page: Page,
): Promise<{ kind: string; [key: string]: unknown }[]> {
  await page.locator("details.developer > summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download session observations" }).click();
  const path = await (await download).path();
  const exported = JSON.parse(await readFile(path, "utf8")) as {
    observations: { kind: string; [key: string]: unknown }[];
  };
  return exported.observations;
}

function accessRecords(observations: { kind: string; [key: string]: unknown }[]) {
  return observations.filter((observation) => observation.kind === "endpoint-access");
}

test.describe("the relay's read route", () => {
  test.beforeEach(async () => {
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
    test.skip(!(await answering(`${NOCORS}/?f=json`)), "pygeoapi :5081 is not answering");
  });

  test("asks before using the relay, then runs sync and async through it", async ({ page }) => {
    const relayRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(`${RELAY}/read/`)) relayRequests.push(request.url());
    });

    await connectConfigured(page, "pygeoapi-nocors-relay");
    const offer = page.getByTestId("relay-offer");
    await expect(offer).toBeVisible();
    await expect(offer).toContainText(
      "This server sent no CORS headers, so a web page cannot read it directly. Reach it through the relay instead? This will be recorded as a finding.",
    );
    // The direct attempt is over, and nothing has gone through the relay yet.
    expect(relayRequests).toEqual([]);

    await page.getByRole("button", { name: "Use relay" }).click();
    await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();
    const banner = page.getByTestId("relay-banner");
    await expect(banner).toHaveText(
      "Reached through the relay — this server does not allow direct access from a web page.",
    );
    expect(relayRequests.length).toBeGreaterThan(0);

    // Synchronous: the result itself comes back through the relay.
    await page.getByRole("button", { name: "Hello World", exact: true }).click();
    await page.getByRole("textbox", { name: "Name (required)" }).fill("relay");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator('[data-output-id="echo"]')).toContainText("Hello relay", {
      timeout: 15_000,
    });
    await expect(banner).toBeVisible();

    // Asynchronous: named by the relay's execute route, then polled and its
    // results read through the read route.
    await page.getByRole("button", { name: "Change the inputs" }).click();
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator('[data-output-id="echo"]')).toContainText("Hello relay", {
      timeout: 30_000,
    });
    expect(relayRequests.some((url) => /\/read\/pygeoapi-nocors-relay\/jobs\//.test(url))).toBe(
      true,
    );

    const records = accessRecords(await exportedObservations(page));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      endpointKey: "pygeoapi-nocors-relay",
      source: "configured",
      outcome: "cors-blocked",
      relayConfigured: true,
      userConfirmedRelay: true,
      relayOutcome: "ok",
      routeUsed: "relay",
    });
  });

  test("sends nothing through the relay when the user cancels", async ({ page }) => {
    const relayRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(`${RELAY}/read/`)) relayRequests.push(request.url());
    });

    await connectConfigured(page, "pygeoapi-nocors-relay");
    await expect(page.getByTestId("relay-offer")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("relay-offer")).toBeHidden();
    await expect(page.getByRole("alert")).toContainText(
      "This server doesn't allow access from a web page (no CORS headers).",
    );
    await expect(page.getByTestId("relay-banner")).toHaveCount(0);
    expect(relayRequests).toEqual([]);

    const records = accessRecords(await exportedObservations(page));
    expect(records).toEqual([
      expect.objectContaining({
        outcome: "cors-blocked",
        relayConfigured: true,
        userConfirmedRelay: false,
        routeUsed: "none",
      }),
    ]);
    // The export writes JSON, which drops an undefined member: no relay attempt.
    expect(records[0]).not.toHaveProperty("relayOutcome");
  });

  test("offers nothing for the direct-only no-CORS endpoint", async ({ page }) => {
    await connectConfigured(page, "pygeoapi-nocors");
    await expect(page.getByRole("alert")).toContainText(
      "This server doesn't allow access from a web page (no CORS headers).",
    );
    await expect(page.getByTestId("relay-offer")).toHaveCount(0);

    const records = accessRecords(await exportedObservations(page));
    expect(records).toEqual([
      expect.objectContaining({
        endpointKey: "pygeoapi-nocors",
        outcome: "cors-blocked",
        relayConfigured: false,
        routeUsed: "none",
      }),
    ]);
  });

  test("goes direct to a server that sends CORS headers, with no offer and no banner", async ({
    page,
  }) => {
    test.skip(!(await answering(`${CORS}/?f=json`)), "pygeoapi :5080 is not answering");
    await connectConfigured(page, "pygeoapi-cors");
    await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();
    await expect(page.getByTestId("relay-offer")).toHaveCount(0);
    await expect(page.getByTestId("relay-banner")).toHaveCount(0);

    const records = accessRecords(await exportedObservations(page));
    expect(records).toEqual([
      expect.objectContaining({ outcome: "connected", routeUsed: "direct" }),
    ]);
  });
});
