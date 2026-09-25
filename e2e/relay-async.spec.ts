/**
 * The claim finding 0039 said we could not make: a browser starts an
 * asynchronous job, learns its ID, and watches it complete.
 *
 * Driven through the real app against the real relay and the pinned pygeoapi,
 * with callbacks on (infra/relay/ci.json). The same page is then pointed at
 * the same server *without* the relay, to show the difference is the relay
 * and not the page: on the direct route the job starts and cannot be named.
 *
 * Skips itself when pygeoapi or the relay is not answering, as the other
 * browser specs do.
 */

import { expect, test, type Page } from "@playwright/test";

const PYGEOAPI = "http://localhost:5080";
const RELAY = "http://localhost:8787";
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

async function start(
  page: Page,
  endpoint: string,
  processId: string,
  inputs: string,
  outputs = "{}",
) {
  // The Task 6 job panel is a developer view now, open with ?developer.
  await page.goto("/?developer");
  await expect(page.getByTestId("relay-state")).toContainText("open");
  await page.getByTestId("endpoint").selectOption(endpoint);
  await page.getByTestId("process-id").fill(processId);
  await page.getByTestId("inputs").fill(inputs);
  await page.getByTestId("outputs").fill(outputs);
  await page.getByTestId("run").click();
}

test.describe("asynchronous execution from a browser", () => {
  test.beforeEach(async () => {
    test.skip(!(await answering(`${PYGEOAPI}/?f=json`)), "pygeoapi :5080 is not answering");
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
  });

  test("through the relay: the job is named at once and seen to complete", async ({ page }) => {
    await start(page, "pygeoapi-cors", "slow", '{"seconds": 3}');

    const job = page.getByTestId("job");
    await expect(job).toHaveCount(1);
    await expect(job).toHaveAttribute("data-route", "relay");
    // Named: the first poll, straight from the browser to pygeoapi, read the
    // job document at the URL the relay handed back.
    await expect(job).toHaveAttribute("data-job-id", JOB_ID);
    await expect(job).toHaveAttribute("data-status", "successful", { timeout: 30_000 });
    // And the doorbell rang: pygeoapi called the relay, the relay rang the page.
    expect(Number(await job.getAttribute("data-doorbells"))).toBeGreaterThanOrEqual(1);

    const observations = await page.getByTestId("observations").textContent();
    expect(observations).toContain('"kind": "execute-route"');
    expect(observations).toContain('"route": "relay"');
    expect(observations).toContain('"locationPresent": true');
  });

  test("the same server without the relay: the job starts and cannot be named (finding 0039)", async ({
    page,
  }) => {
    // The Task 6 job panel is a developer view now, open with ?developer.
    await page.goto("/?developer");
    await page.getByTestId("endpoint").selectOption("manual");
    await page.getByTestId("manual-base").fill(PYGEOAPI);
    await page.getByTestId("process-id").fill("slow");
    await page.getByTestId("inputs").fill('{"seconds": 1}');
    await page.getByTestId("run").click();

    // The core refuses to guess which job is ours.
    await expect(page.getByTestId("error")).toContainText(/Location/);
    await expect(page.getByTestId("job")).toHaveCount(0);
    const observations = await page.getByTestId("observations").textContent();
    expect(observations).toContain('"route": "direct"');
  });

  test("no-CORS port: the relay names the job, and the browser still cannot read it", async ({
    page,
  }) => {
    test.skip(
      !(await answering("http://localhost:5081/?f=json")),
      "pygeoapi :5081 is not answering",
    );
    await start(page, "pygeoapi-nocors", "slow", '{"seconds": 1}');

    const job = page.getByTestId("job");
    await expect(job).toHaveAttribute("data-route", "relay");
    // Known by URL, never read: every poll fails, because :5081 sends no
    // Access-Control-Allow-Origin. The relay does not proxy reads, by design.
    await expect(job).toContainText("last read failed");
    await expect(job).toHaveAttribute("data-status", "");
  });
});
