/**
 * Not a test: drives the web client against the local reference stack and
 * saves one observation export per endpoint, the interoperability matrix's
 * evidence. Run with `pnpm capture:observations` (project `capture`); no test
 * lane picks this file up.
 *
 * Everything goes through the product's own screens, as a person would use
 * them: connect (direct first; the relay only where it is offered, and only
 * after confirming), describe every process, run a handful of processes both
 * ways, load a reference, cancel a job.
 *
 * What a server does is recorded, never asserted. A failed run, a mode the
 * server did not honour or a blocked read is the evidence, so each run is
 * waited on until it settles, whatever its outcome, and the capture moves on.
 * It fails only when the client itself cannot be driven: a control that is not
 * there, or a run that never settles.
 *
 * Nothing here rewrites a server's answer (no `page.route`): the matrix must
 * show what each server really says.
 *
 * Writes to `OBSERVATIONS_OUT` (default `.playwright/observations`), under the
 * file name the client suggests, plus a `capture-log.txt` of what each step
 * showed on screen.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { RELAY } from "./servers.js";
import { requireService } from "./services.js";

const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";
const ZOO = "http://localhost:5090/ogc-api";

const OUT = resolve(process.env["OBSERVATIONS_OUT"] ?? ".playwright/observations");

/** One line per step, so the export can be read against what the page showed. */
async function log(line: string): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await appendFile(join(OUT, "capture-log.txt"), `${new Date().toISOString()} ${line}\n`);
}

async function developerPanel(page: Page): Promise<void> {
  const panel = page.locator("details.developer");
  if ((await panel.getAttribute("open")) === null) await panel.locator("> summary").click();
}

async function connectConfigured(page: Page, key: string): Promise<void> {
  await page.getByRole("radio", { name: new RegExp(`^${key} `) }).check();
  await page.getByRole("button", { name: "Connect" }).click();
}

/** Wait for the process list, after a connection or a confirmed relay. */
async function processList(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible({
    timeout,
  });
}

/** The census: every listed process described once. Waits for it to finish, failures and all. */
async function describeEveryProcess(page: Page, timeout: number): Promise<void> {
  await developerPanel(page);
  await page.getByRole("button", { name: "Describe every process" }).click();
  const status = page.getByRole("status").filter({ hasText: "Process census of" });
  await expect(status).toHaveText(/described(, \d+ could not be read)?\.$/, { timeout });
  await log(`census: ${(await status.textContent()) ?? ""}`);
}

/** Open a process by its id: titles repeat on some servers (ZOO has several "Echo input"). */
async function openProcess(page: Page, id: string): Promise<void> {
  await page
    .getByRole("listitem")
    .filter({ has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByRole("button", { name: "All processes" })).toBeVisible();
}

/**
 * Run the open process in `mode`, wait until the run settles, and log what the
 * page shows. Where the page offers no choice, the one mode it offers is used,
 * and the log says so.
 */
async function run(
  page: Page,
  label: string,
  mode: "sync" | "async",
  options: { readonly timeout?: number; readonly cancel?: boolean } = {},
): Promise<void> {
  const choice = page.getByRole("checkbox", { name: "Run in the background" });
  const offersChoice = (await choice.count()) > 0;
  if (offersChoice) await choice.setChecked(mode === "async");
  const onlyAsync = await page
    .getByRole("button", { name: "Run in the background", exact: true })
    .count();
  const asked = offersChoice ? mode : onlyAsync > 0 ? "async (only choice)" : "sync (only choice)";
  await page
    .getByRole("button", { name: onlyAsync > 0 ? "Run in the background" : "Run", exact: true })
    .click();

  if (options.cancel === true) {
    const job = page.locator("[data-job-ref]");
    await expect(job).toHaveAttribute("data-job-ref", /./, { timeout: 30_000 });
    await page.getByRole("button", { name: "Cancel job" }).click();
  }

  await expect(page.locator(".running")).toHaveCount(0, { timeout: options.timeout ?? 60_000 });
  const results = page.locator("[data-output-id]");
  const outcome =
    (await results.count()) > 0
      ? `result: ${(await results.evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("data-output-id") ?? "?"}=${node.getAttribute("data-kind") ?? "?"}`))).join(", ")}`
      : `no result: ${(await page.locator(".error-box, .notice").allTextContents()).join(" | ").replace(/\s+/g, " ")}`;
  await log(
    `run ${label}, asked ${asked}${options.cancel === true ? ", cancelled" : ""}: ${outcome}`,
  );
}

/** Load every reference the result offers, and log how each ended. */
async function loadReferences(page: Page, label: string): Promise<void> {
  const references = page.locator('[data-output-id][data-kind="reference"]');
  for (const reference of await references.all()) {
    await reference.getByRole("button", { name: "Load" }).click();
    await expect(reference).toHaveAttribute("data-reference-outcome", /./, { timeout: 30_000 });
    await log(
      `load ${label} ${(await reference.getAttribute("data-output-id")) ?? "?"}: ${(await reference.getAttribute("data-reference-outcome")) ?? "?"}`,
    );
  }
}

/** Back to the form after a run: from a result, or already there after a failure. */
async function again(page: Page): Promise<void> {
  const edit = page.getByRole("button", { name: "Change the inputs" });
  if ((await edit.count()) > 0) await edit.click();
}

async function backToList(page: Page): Promise<void> {
  await page.getByRole("button", { name: "All processes" }).click();
  await processList(page);
}

async function fill(page: Page, label: string, value: string): Promise<void> {
  await page.getByRole("textbox", { name: label }).fill(value);
}

/** One endpoint's export, saved under the name the client gives it. */
async function exportEndpoint(page: Page, endpoint: string): Promise<void> {
  await developerPanel(page);
  await page.getByRole("combobox", { name: "Observations from" }).selectOption(endpoint);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download this endpoint's observations" }).click();
  const file = await download;
  await mkdir(OUT, { recursive: true });
  const path = join(OUT, file.suggestedFilename());
  await file.saveAs(path);
  await log(`exported ${endpoint} → ${file.suggestedFilename()}`);
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await requireService(`${RELAY}/healthz`, "the relay");
  await page.goto("/");
  // Callbacks are asked for only while the doorbell stream is open.
  await expect(page.locator(".app")).toHaveAttribute("data-relay-stream", "open", {
    timeout: 15_000,
  });
});

test("pygeoapi with CORS headers (:5080)", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await requireService(`${CORS}/?f=json`, "pygeoapi :5080");
  await log("--- pygeoapi-cors");
  await connectConfigured(page, "pygeoapi-cors");
  await processList(page);
  await describeEveryProcess(page, 5 * 60_000);

  await openProcess(page, "hello-world");
  await fill(page, "Name (required)", "capture");
  await run(page, "hello-world", "sync");
  await again(page);
  await run(page, "hello-world", "async");
  await backToList(page);

  // Declares sync-execute only, and pygeoapi describes it with both (finding 0059).
  await openProcess(page, "breinstein-sync-only");
  await fill(page, "Seconds (optional)", "0");
  await run(page, "breinstein-sync-only", "async");
  await backToList(page);

  // Declares async-execute only.
  await openProcess(page, "breinstein-async-only");
  await fill(page, "Seconds (optional)", "0");
  await run(page, "breinstein-async-only", "sync");
  await backToList(page);

  await openProcess(page, "breinstein-png");
  await run(page, "breinstein-png", "sync");
  await backToList(page);

  await openProcess(page, "breinstein-fail-late");
  await fill(page, "Seconds (optional)", "1");
  await run(page, "breinstein-fail-late", "async");
  await backToList(page);

  // A reference to :5081, which sends no CORS headers.
  await openProcess(page, "breinstein-link");
  await run(page, "breinstein-link", "sync");
  await loadReferences(page, "breinstein-link");
  await backToList(page);

  await openProcess(page, "slow");
  await fill(page, "Seconds (optional)", "120");
  await run(page, "slow", "async", { cancel: true });
  await backToList(page);

  // A typed address is always reached directly, so this background run goes
  // straight to pygeoapi: the page has to find the job by `Location` itself
  // (finding 0039).
  await log("--- typed address");
  await page.getByRole("button", { name: "Change service" }).click();
  await page.getByRole("radio", { name: "Another service" }).check();
  await fill(page, "Service address", CORS);
  await page.getByRole("button", { name: "Connect" }).click();
  await processList(page);
  await openProcess(page, "hello-world");
  await fill(page, "Name (required)", "capture");
  await run(page, "hello-world (typed address)", "async");

  await exportEndpoint(page, `${CORS}/`);
});

test("pygeoapi without CORS headers (:5081), direct-only and through the read route", async ({
  page,
}) => {
  test.setTimeout(15 * 60_000);
  await requireService(`${NOCORS}/?f=json`, "pygeoapi :5081");
  await log("--- pygeoapi-nocors");
  await connectConfigured(page, "pygeoapi-nocors");
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await log(`connect pygeoapi-nocors: ${(await page.getByRole("alert").textContent()) ?? ""}`);

  await log("--- pygeoapi-nocors-relay");
  await connectConfigured(page, "pygeoapi-nocors-relay");
  await expect(page.getByTestId("relay-offer")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Use relay" }).click();
  await processList(page);
  await describeEveryProcess(page, 5 * 60_000);

  await openProcess(page, "hello-world");
  await fill(page, "Name (required)", "capture");
  await run(page, "hello-world", "sync");
  await again(page);
  await run(page, "hello-world", "async");
  await backToList(page);

  await openProcess(page, "breinstein-sync-only");
  await fill(page, "Seconds (optional)", "0");
  await run(page, "breinstein-sync-only", "async");
  await backToList(page);

  // A reference to :5080, which a page can read directly.
  await openProcess(page, "breinstein-link");
  await run(page, "breinstein-link", "sync");
  await loadReferences(page, "breinstein-link");
  await backToList(page);

  await openProcess(page, "slow");
  await fill(page, "Seconds (optional)", "120");
  await run(page, "slow", "async", { cancel: true });

  await exportEndpoint(page, `${NOCORS}/`);
});

test("ZOO-Project (:5090), through the read route", async ({ page }) => {
  // Some 700 processes, every description read through the relay.
  test.setTimeout(30 * 60_000);
  await requireService(`${ZOO}/`, "ZOO :5090");
  await log("--- zoo");
  await connectConfigured(page, "zoo");
  await expect(page.getByTestId("relay-offer")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Use relay" }).click();
  await processList(page, 120_000);
  await describeEveryProcess(page, 20 * 60_000);

  await openProcess(page, "echo");
  await fill(page, "Literal Input (string) (optional)", "capture");
  // ZOO refuses to answer output `c` when input `c` is empty, and the client
  // names every output (finding 0025): give it a box.
  await fill(page, "West (minimum longitude)", "4.8");
  await fill(page, "South (minimum latitude)", "52.3");
  await fill(page, "East (maximum longitude)", "4.9");
  await fill(page, "North (maximum latitude)", "52.4");
  await fill(page, "Literal Input (double) (optional)", "1");
  await run(page, "echo", "sync");
  await again(page);
  await run(page, "echo", "async");
  await again(page);
  await fill(page, "Literal Input (double) (optional)", "60");
  await run(page, "echo", "async", { cancel: true });

  await exportEndpoint(page, ZOO);
});
