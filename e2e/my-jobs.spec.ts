/**
 * "My jobs" (package 4): a background job is listed, survives a reload, and
 * is polled again from storage that holds four fields and nothing more.
 * Remove from list is local and sticks.
 *
 * Through the relay's pygeoapi endpoint, because only the relay can name a
 * job pygeoapi starts for a web page (finding 0039). Skips when the relay or
 * pygeoapi is not answering, as the other browser specs do.
 */

import { expect, test } from "@playwright/test";

const PYGEOAPI = "http://localhost:5080";
const RELAY = "http://localhost:8787";
const STORAGE_KEY = "oap-client.jobs.v1";

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

test.describe("My jobs", () => {
  test.beforeEach(async () => {
    test.skip(!(await answering(`${PYGEOAPI}/?f=json`)), "pygeoapi :5080 is not answering");
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
  });

  test("lists a background job, keeps it across a reload, and removes it for good", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate((key) => {
      localStorage.removeItem(key);
    }, STORAGE_KEY);

    await page.getByRole("radio", { name: /pygeoapi-cors/ }).check();
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "Slow process", exact: true }).click();
    await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("1");
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator('[data-output-id="slept"]')).toBeVisible({ timeout: 30_000 });

    const panel = page.getByTestId("my-jobs");
    const row = panel.locator("[data-job-row]");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("slow");
    await expect(row).toContainText("on localhost:5080");
    await expect(row.locator("[data-job-status]")).toHaveAttribute("data-job-status", "successful");
    await expect(row.getByRole("link", { name: "Results" })).toHaveAttribute(
      "href",
      /^http:\/\/localhost:5080\/jobs\/[^/]+\/results/,
    );
    const statusUrl = (await row.getAttribute("data-job-row")) ?? "";

    // Four fields, and no token of any kind.
    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    const entries = JSON.parse(stored ?? "[]") as Record<string, unknown>[];
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual([
      "endpoint",
      "processId",
      "startedAt",
      "statusUrl",
    ]);
    expect(entries[0]?.["statusUrl"]).toBe(statusUrl);
    expect(stored).not.toMatch(/token|callbacks|seconds/i);

    // A reload: the job is back, from storage, and read from the server again.
    const reread = page.waitForRequest((request) => request.url().startsWith(statusUrl));
    await page.reload();
    await reread;
    const restored = page.getByTestId("my-jobs").locator("[data-job-row]");
    await expect(restored).toHaveAttribute("data-restored", "true");
    await expect(restored.locator("[data-job-status]")).toHaveAttribute(
      "data-job-status",
      "successful",
    );

    // Remove from list: gone, and still gone after another reload. Nothing is
    // sent to the server.
    const deletes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE") deletes.push(request.url());
    });
    await restored.getByRole("button", { name: "Remove from list" }).click();
    await expect(page.getByTestId("my-jobs")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("radio", { name: /pygeoapi-cors/ })).toBeVisible();
    await expect(page.getByTestId("my-jobs")).toHaveCount(0);
    expect(deletes).toEqual([]);
  });
});
