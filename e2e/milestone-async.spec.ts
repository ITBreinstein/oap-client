/**
 * The end-of-September milestone, through the product's own screens rather
 * than the developer panel:
 *
 * 1. an asynchronous run on pygeoapi, with a subscriber;
 * 2. pygeoapi posts its callbacks to the relay;
 * 3. the relay rings the page over its event stream;
 * 4. the page polls the job's status from pygeoapi;
 * 5. the result is shown.
 *
 * In the blocking lane: under CI it never skips, so a stack that did not come
 * up fails the build instead of passing it quietly — as every browser spec now
 * does (`services.ts`). Locally it skips when pygeoapi or the relay is not
 * answering.
 *
 * And the other side of the rule the milestone rests on: with the relay's
 * event stream not open, the job is started without a session — so without a
 * subscriber — and is still found and finished by polling (finding 0047).
 */

import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { RELAY } from "./servers.js";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";

async function observations(page: Page): Promise<{ kind: string; [key: string]: unknown }[]> {
  await page.locator("details.developer > summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download session observations" }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8")) as {
    observations: { kind: string; [key: string]: unknown }[];
  };
  return exported.observations;
}

/** Connect to pygeoapi through the relay's configured endpoint and start `slow` in the background. */
async function runSlowInBackground(page: Page) {
  await page.getByRole("radio", { name: /pygeoapi-cors/ }).check();
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Slow process", exact: true }).click();
  await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("3");
  await page.getByRole("checkbox", { name: "Run in the background" }).check();
  await page.getByRole("button", { name: "Run", exact: true }).click();
}

test.describe("the asynchronous milestone", () => {
  test.beforeEach(async () => {
    await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
    await requireService(`${RELAY}/healthz`, "the relay");
  });

  test("callback, doorbell, poll, result — end to end", async ({ page }) => {
    await page.goto("/");
    // Callbacks are asked for only while the doorbell stream is open.
    await expect(page.locator(".app")).toHaveAttribute("data-relay-stream", "open", {
      timeout: 15_000,
    });

    await runSlowInBackground(page);

    // 1. The relay registered callbacks, so it sent pygeoapi a subscriber.
    const running = page.locator("[data-job-ref]");
    await expect(running).toHaveAttribute("data-callbacks", "registered", { timeout: 15_000 });
    const jobUrl = (await running.getAttribute("data-job-ref")) ?? "";
    expect(jobUrl).toMatch(/^http:\/\/localhost:5080\/jobs\//);

    // 5. The result is on screen.
    const result = page.locator(`[data-result-of="${jobUrl}"]`);
    await expect(result.locator('[data-output-id="slept"]')).toBeVisible({ timeout: 30_000 });

    // 2 and 3. pygeoapi called the relay, and the relay rang this page. Read
    // from the result, not the running view. pygeoapi's in-progress callback
    // can ring before the page is tracking the job (tracking starts with a
    // read, so nothing is lost), and its success callback arrives together
    // with the read that finds the job done — so the running view is gone
    // before a check on it could see the count.
    await expect(result).toHaveAttribute("data-callbacks", "registered");
    await expect(result).toHaveAttribute("data-doorbells", /^[1-9]\d*$/, { timeout: 5_000 });
    // The confirming read found nothing changed (the relay was up throughout).
    await page.waitForTimeout(3_000);
    await expect(page.locator("[data-status-changed]")).toHaveCount(0);

    // 4. The status came from polling pygeoapi: every read is on record, the
    // first `successful` and the confirming read after it included.
    const recorded = await observations(page);
    expect(recorded).toContainEqual(
      expect.objectContaining({
        kind: "execute-route",
        route: "relay",
        outcome: "sent",
        callbacksRegistered: true,
        sessionWithheld: false,
      }),
    );
    const jobId = jobUrl.split("/").pop() ?? "";
    const reads = recorded.filter(
      (observation) => observation.kind === "job-status" && String(observation.url).includes(jobId),
    );
    expect(reads.filter((read) => read.status === "successful").length).toBeGreaterThanOrEqual(2);
  });

  test("with the relay's event stream not open, the job runs for polling only", async ({
    page,
  }) => {
    // The stream cannot open; everything else on the relay still answers.
    await page.route(`${RELAY}/sessions/events`, (route) => route.abort());
    await page.goto("/");
    await expect(page.locator(".app")).toHaveAttribute("data-relay-stream", /connecting|waiting/);

    await runSlowInBackground(page);

    const running = page.locator("[data-job-ref]");
    await expect(running).toHaveAttribute("data-callbacks", "none", { timeout: 15_000 });
    await expect(page.locator('[data-output-id="slept"]')).toBeVisible({ timeout: 30_000 });

    const recorded = await observations(page);
    expect(recorded).toContainEqual(
      expect.objectContaining({
        kind: "execute-route",
        route: "relay",
        outcome: "sent",
        callbacksRegistered: false,
        sessionWithheld: true,
      }),
    );
  });
});
