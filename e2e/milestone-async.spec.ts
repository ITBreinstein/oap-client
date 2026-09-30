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
 * up fails the build instead of passing it quietly. Locally it skips when
 * pygeoapi or the relay is not answering, as the other browser specs do.
 *
 * And the other side of the rule the milestone rests on: with the relay's
 * event stream not open, the job is started without a session — so without a
 * subscriber — and is still found and finished by polling (finding 0047).
 */

import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const PYGEOAPI = "http://localhost:5080";
const RELAY = "http://localhost:8787";

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

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
    if (process.env["CI"]) return;
    test.skip(!(await answering(`${PYGEOAPI}/?f=json`)), "pygeoapi :5080 is not answering");
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
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

    // 2 and 3. pygeoapi called the relay, and the relay rang this page.
    await expect(running).toHaveAttribute("data-doorbells", /^[1-9]\d*$/, { timeout: 15_000 });

    // 5. The result is on screen.
    await expect(page.locator('[data-output-id="slept"]')).toBeVisible({ timeout: 30_000 });
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
