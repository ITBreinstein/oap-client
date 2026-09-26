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
 * The last test is phase 3: the read route. The page still tries ZOO directly
 * first and fails, and only after the user confirms does it reach ZOO through
 * the relay, with the banner shown and the direct failure still on the record.
 *
 * ZOO is the interop server, not the pinned one, so every test here skips
 * when it is not answering. One job per run, to spare its worker pool
 * (finding 0044).
 */

import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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

  test("through the read route, after the user confirms: list, banner, a sync run", async ({
    page,
  }) => {
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
    // ZOO lists some 700 processes, every page of them now through the relay.
    test.setTimeout(90_000);
    await page.getByRole("radio", { name: /^zoo / }).check();
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByTestId("relay-offer")).toBeVisible();
    await page.getByRole("button", { name: "Use relay" }).click();
    await expect(page.getByTestId("relay-banner")).toBeVisible({ timeout: 30_000 });

    // Several ZOO processes are titled "Echo input"; the one with id `echo`.
    await page
      .getByRole("listitem")
      .filter({ has: page.locator("code", { hasText: /^echo$/ }) })
      .getByRole("button", { name: "Echo input", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Literal Input (string) (optional)" })
      .fill("through the relay");
    // The web app names every output (finding 0025), and ZOO refuses to answer
    // output `c` when input `c` is empty, so the run gives it a box.
    await page.getByRole("textbox", { name: "West (minimum longitude)" }).fill("4.8");
    await page.getByRole("textbox", { name: "South (minimum latitude)" }).fill("52.3");
    await page.getByRole("textbox", { name: "East (maximum longitude)" }).fill("4.9");
    await page.getByRole("textbox", { name: "North (maximum latitude)" }).fill("52.4");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator('[data-output-id="a"]')).toContainText("through the relay", {
      timeout: 30_000,
    });

    // ZOO stays recorded as unusable from a web page: the direct failure is on
    // the same record as the relay attempt that worked.
    // Opened with ?developer, so the panel may already be open.
    const developer = page.locator("details.developer");
    if ((await developer.getAttribute("open")) === null) {
      await developer.locator("summary").click();
    }
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download session observations" }).click();
    const exported = JSON.parse(await readFile(await (await download).path(), "utf8")) as {
      observations: { kind: string; [key: string]: unknown }[];
    };
    expect(exported.observations.filter((entry) => entry.kind === "endpoint-access")).toEqual([
      expect.objectContaining({
        endpointKey: "zoo",
        outcome: "cors-blocked",
        userConfirmedRelay: true,
        relayOutcome: "ok",
        routeUsed: "relay",
      }),
    ]);
  });
});
