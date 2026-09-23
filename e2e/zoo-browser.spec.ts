/**
 * What a browser can do against ZOO-Project, cross-origin: nothing.
 *
 * Finding 0009 says ZOO sends no CORS headers, and finding 0039 inferred from
 * that that a browser cannot even start a job there. This file turns the
 * inference into an observation — in a real browser — on the three
 * operations that matter, and then shows that the relay's narrow route B
 * does not change the answer: it names the job, and the page still cannot
 * read it.
 *
 * ZOO is the interop server, not the pinned one, so every test here skips
 * when it is not answering. One job per run, to spare its worker pool
 * (finding 0044).
 */

import { expect, test } from "@playwright/test";

const ZOO = "http://localhost:5090/ogc-api";
const RELAY = "http://localhost:8787";

async function answering(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

test.describe("ZOO-Project from a browser", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await answering(`${ZOO}/`)), "ZOO :5090 is not answering");
    // The Task 6 job panel is a developer view now, open with ?developer.
    await page.goto("/?developer");
  });

  test("cannot send an execute at all — the preflight has no CORS headers", async ({ page }) => {
    const outcome = await page.evaluate(async (base: string) => {
      try {
        const response = await fetch(`${base}/processes/echo/execution`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "respond-async" },
          body: JSON.stringify({ inputs: { a: "x" }, outputs: {} }),
        });
        return `status ${String(response.status)}`;
      } catch (error) {
        return error instanceof TypeError ? "blocked" : String(error);
      }
    }, ZOO);
    expect(outcome).toBe("blocked");
  });

  test("cannot read a landing page, a job list, or anything else", async ({ page }) => {
    const outcomes = await page.evaluate(async (base: string) => {
      const results: string[] = [];
      for (const path of ["/", "/jobs", "/processes"]) {
        try {
          const response = await fetch(`${base}${path}`, {
            headers: { Accept: "application/json" },
          });
          results.push(`status ${String(response.status)}`);
        } catch (error) {
          results.push(error instanceof TypeError ? "blocked" : String(error));
        }
      }
      return results;
    }, ZOO);
    expect(outcomes).toEqual(["blocked", "blocked", "blocked"]);
  });

  test("through the relay: the job is named, and still cannot be read", async ({ page }) => {
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
    await expect(page.getByTestId("relay-state")).toContainText("open");
    await page.getByTestId("endpoint").selectOption("zoo");
    await page.getByTestId("process-id").fill("echo");
    await page.getByTestId("inputs").fill('{"a": "relay"}');
    // ZOO refuses an execute body without `outputs` (finding 0025).
    await page.getByTestId("outputs").fill('{"a": {"transmissionMode": "value"}}');
    await page.getByTestId("run").click();

    const job = page.getByTestId("job");
    await expect(job).toHaveAttribute("data-route", "relay");
    await expect(job).toContainText("last read failed");
  });
});
