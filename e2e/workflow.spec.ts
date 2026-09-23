/**
 * The workflow a user sees, end to end in Chromium against the pinned
 * pygeoapi (Task 7, S8): connect, choose, fill in, draw, run, see the result.
 *
 * `:5080` is the only server a page can read (findings 0049, 0050), and the
 * three `breinstein-*` processes exist on it so that a generated form has
 * something to be tested against (infra/README.md). Assertions are made on
 * what reached the server — the request body, or the process's own echo —
 * not on what the page believes it sent.
 *
 * Skips itself when pygeoapi, or for the relay test the relay, is not
 * answering, as the other browser specs do.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const PYGEOAPI = "http://localhost:5080";
const NOCORS = "http://localhost:5081";
const RELAY = "http://localhost:8787";
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

async function answering(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

/** Connect to a typed address, which is always reached directly (T8). */
async function connectTyped(page: Page, address: string) {
  await page.goto("/");
  const typed = page.getByRole("radio", { name: "Another service" });
  if (await typed.isVisible()) await typed.check();
  await page.getByRole("textbox", { name: "Service address" }).fill(address);
  await page.getByRole("button", { name: "Connect" }).click();
}

async function openProcess(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
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

test.describe("the workflow in a browser", () => {
  test.beforeEach(async () => {
    test.skip(!(await answering(`${PYGEOAPI}/?f=json`)), "pygeoapi :5080 is not answering");
  });

  test("draws a bounding box, sends it in CRS84 order, and downloads the result", async ({
    page,
  }) => {
    await connectTyped(page, PYGEOAPI);
    await openProcess(page, "Bounding box to feature");

    await page.getByRole("button", { name: "Draw on the map" }).click();
    const canvas = page.locator(".map-canvas canvas").first();
    await expect(canvas).toBeVisible();
    // The map opens on the Netherlands; drag across its middle.
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("the map has no size");
    const from = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.35 };
    const to = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.65 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    const west = page.getByRole("textbox", { name: "West (minimum longitude)" });
    await expect(west).not.toHaveValue("");
    const shown = await Promise.all(
      [
        "West (minimum longitude)",
        "South (minimum latitude)",
        "East (maximum longitude)",
        "North (maximum latitude)",
      ].map(async (name) => Number(await page.getByRole("textbox", { name }).inputValue())),
    );

    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" && candidate.url().includes("/breinstein-bbox/execution"),
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const body = (await request).postDataJSON() as {
      inputs: { bbox: { bbox: number[]; crs: string } };
      outputs: Record<string, unknown>;
    };

    // What was drawn is what was sent: longitude first, CRS84, the CRS explicit.
    expect(body.inputs.bbox).toEqual({ bbox: shown, crs: CRS84 });
    const [minX = 0, minY = 0, maxX = 0, maxY = 0] = body.inputs.bbox.bbox;
    // The Netherlands: longitudes 3–8 °E, latitudes 50–54 °N. Swapped axes would
    // put latitudes in the first and third place.
    expect(minX).toBeGreaterThan(3);
    expect(maxX).toBeLessThan(8);
    expect(minY).toBeGreaterThan(50);
    expect(maxY).toBeLessThan(54);
    expect(minX).toBeLessThan(maxX);
    expect(minY).toBeLessThan(maxY);
    expect(body.outputs).toEqual({ feature: {} });

    await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: /^Download/ })
      .first()
      .click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("breinstein-bbox-feature.json");
    const feature = JSON.parse(await readFile(await saved.path(), "utf8")) as {
      type: string;
      properties: { bbox: number[] };
    };
    expect(feature.type).toBe("Feature");
    expect(feature.properties.bbox).toEqual(shown);
  });

  test("sends every widget's value as the schema says, and the server echoes it", async ({
    page,
  }) => {
    await connectTyped(page, PYGEOAPI);
    await openProcess(page, "Every input kind");

    await page.getByRole("textbox", { name: "Label (required)" }).fill("plugfest");
    await page.getByRole("textbox", { name: "Notes (required)" }).fill("first line\nsecond line");
    await page.getByRole("textbox", { name: "Count (required)" }).fill("7");
    await page.getByRole("textbox", { name: "Ratio (required)" }).fill("0.25");
    await page.getByRole("combobox", { name: "Colour (required)" }).selectOption({ label: "blue" });
    await page.getByRole("checkbox", { name: "Enabled (required)" }).check();
    await page.getByRole("textbox", { name: "Tags, value 1" }).fill("a");
    await page.getByRole("button", { name: "Add a value" }).click();
    await page.getByRole("textbox", { name: "Tags, value 2" }).fill("b");
    // Comment is optional and left empty: it must not be sent at all.

    await page.getByRole("button", { name: "Run", exact: true }).click();
    const echo = page.locator('[data-output-id="echo"] pre');
    await expect(echo).toBeVisible();
    const received: unknown = JSON.parse(await echo.innerText());

    expect(received).toEqual({
      label: "plugfest",
      notes: "first line\nsecond line",
      count: 7,
      ratio: 0.25,
      colour: "blue",
      enabled: true,
      tags: ["a", "b"],
    });
    const summary = page.locator('[data-output-id="summary"]');
    await expect(summary).toHaveAttribute("data-kind", "text");
    await expect(summary).toContainText('tags: ["a", "b"]');
  });

  test("shows the raw JSON editor, with its reason, for an input it cannot handle, and still runs", async ({
    page,
  }) => {
    // No live process has an input the generator refuses any more, so one is
    // injected: breinstein-inputs, its optional `comment` turned into a
    // oneOf of plain types, which is not the complex-input pattern.
    await page.route(
      (url) => url.pathname === "/processes/breinstein-inputs",
      async (route) => {
        const response = await route.fetch();
        const description = (await response.json()) as {
          inputs: Record<string, { schema: unknown }>;
        };
        const comment = description.inputs["comment"];
        if (comment !== undefined)
          comment.schema = { oneOf: [{ type: "string" }, { type: "number" }] };
        await route.fulfill({ response, json: description });
      },
    );
    await connectTyped(page, PYGEOAPI);
    await openProcess(page, "Every input kind");

    const field = page.locator('[data-input-id="comment"]');
    await expect(field).toHaveAttribute("data-control", "json");
    await expect(field).toContainText("`oneOf` is outside the supported JSON Schema subset");

    await page.getByRole("textbox", { name: "Label (required)" }).fill("fallback");
    await page.getByRole("textbox", { name: "Notes (required)" }).fill("n");
    await page.getByRole("textbox", { name: "Count (required)" }).fill("1");
    await page.getByRole("combobox", { name: "Colour (required)" }).selectOption({ label: "red" });
    await page.getByRole("textbox", { name: "Tags, value 1" }).fill("t");
    await field.getByRole("textbox").fill('"typed as JSON"');

    await page.getByRole("button", { name: "Run", exact: true }).click();
    const echo = page.locator('[data-output-id="echo"] pre');
    await expect(echo).toBeVisible();
    expect(JSON.parse(await echo.innerText())).toMatchObject({ comment: "typed as JSON" });

    const observations = await exportedObservations(page);
    expect(observations).toContainEqual(
      expect.objectContaining({
        kind: "form",
        processId: "breinstein-inputs",
        inputId: "comment",
        code: "unsupported-keyword",
        keyword: "oneOf",
      }),
    );
  });

  test("runs in the background through the relay, then cancels a second run", async ({ page }) => {
    test.skip(!(await answering(`${RELAY}/healthz`)), "the relay is not answering");
    await page.goto("/");
    await page.getByRole("radio", { name: /pygeoapi-cors/ }).check();
    await page.getByRole("button", { name: "Connect" }).click();
    await openProcess(page, "Slow process");

    const seconds = page.getByRole("textbox", { name: "Seconds (optional)" });
    await seconds.fill("2");
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    // The job's status is the reconciler's, read from the server.
    await expect(page.locator("[data-job-status]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-output-id="slept"]')).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Change the inputs" }).click();
    await seconds.fill("120");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const running = page.locator("[data-job-ref]");
    await expect(running).toHaveAttribute("data-job-ref", /\/jobs\//, { timeout: 15_000 });
    const jobUrl = (await running.getAttribute("data-job-ref")) ?? "";
    await page.getByRole("button", { name: "Cancel job" }).click();
    await expect(page.getByText("Job cancelled. The server has dismissed it.")).toBeVisible();

    // Dismissed on the server: pygeoapi deletes a dismissed job (finding 0035).
    const after = await fetch(jobUrl, { headers: { Accept: "application/json" } });
    expect(after.status).toBe(404);

    const observations = await exportedObservations(page);
    expect(observations).toContainEqual(
      expect.objectContaining({
        kind: "cancel-job",
        outcome: "dismissed",
        advertisedBy: "nothing",
      }),
    );
  });

  test("says a typed server allows no web page, and records the attempt", async ({ page }) => {
    test.skip(!(await answering(`${NOCORS}/?f=json`)), "pygeoapi :5081 is not answering");
    await connectTyped(page, NOCORS);

    await expect(page.getByRole("alert")).toContainText(
      "This server doesn't allow access from a web page (no CORS headers). The attempt has been recorded.",
    );
    const observations = await exportedObservations(page);
    expect(observations).toContainEqual(
      expect.objectContaining({
        kind: "endpoint-access",
        endpoint: `${NOCORS}/`,
        source: "typed",
        outcome: "cors-blocked",
      }),
    );
  });
});
