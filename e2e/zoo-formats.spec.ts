/**
 * #F3 against ZOO-Project (1.0): asking for a format leaves the answer's shape
 * as it was. Run from Node with the web app's own request building, as
 * `formats.spec.ts` does for pygeoapi; see `format-shape.ts`.
 *
 * `SAGA.garden_fractals.1` offers its `RESULT` as XML and KML, with nothing
 * to say the XML is GML, so the page asks for KML. ZOO labels every raw
 * answer `application/json` whatever it is (finding 0026), which is why the
 * shape is read from the request's terms, not from the label. It makes a
 * small fractal from defaults: no data needed.
 *
 * And in the browser, through the relay: ZOO's KML, asked for, read and put
 * on the map (#F5).
 *
 * In the ZOO lane: reports, never blocks.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { createClient } from "../packages/core/src/index.js";
import { base64Outputs, outputSelection } from "../apps/web/src/app/run.js";
import { arrivedAs, formatSentLine, formatsToAsk } from "../apps/web/src/results/format-choice.js";
import { toRenderable } from "../apps/web/src/results/renderable.js";
import { shapesWithAndWithoutFormats } from "./format-shape.js";
import { requireService } from "./services.js";

const ZOO = "http://localhost:5090/ogc-api";

test("asking ZOO for KML leaves the answer's shape as it was", async () => {
  test.setTimeout(120_000);
  await requireService(`${ZOO}/`, "ZOO :5090");
  const pair = await shapesWithAndWithoutFormats({
    baseUrl: ZOO,
    processId: "SAGA.garden_fractals.1",
    inputs: { TYPE: "Lines", ANGLE: 55, MINSIZE: 30 },
  });
  test.info().annotations.push({ type: "shapes", description: JSON.stringify(pair) });
  expect(pair.asked).toEqual({ RESULT: "application/vnd.google-earth.kml+xml" });
  expect(pair.with).toEqual(pair.without);
});

test("ZOO's KML, asked for in the browser through the relay, is read and put on the map", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await requireService(`${ZOO}/`, "ZOO :5090");
  await page.goto("/?developer");
  await page.getByRole("radio", { name: /^zoo / }).check();
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("relay-offer")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Use relay" }).click();
  await expect(page.getByTestId("relay-banner")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("searchbox", { name: "Search processes" }).fill("garden_fractals.1");
  await page.getByRole("button", { name: "Pythagoras' Tree", exact: true }).click();
  await expect(page.getByTestId("format-line")).toHaveText(
    "Asked for KML; the service also offers XML.",
  );
  // A small tree, as in format-shape's run: the form's defaults make 5.5 MB.
  await page.getByRole("combobox", { name: /^Shape Type/ }).selectOption({ label: "Lines" });
  await page.getByRole("textbox", { name: /^Angle/ }).fill("55");
  await page.getByRole("textbox", { name: /^Minimum Size/ }).fill("30");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const result = page.locator('[data-output-id="RESULT"]');
  await expect(result).toHaveAttribute("data-plotted", "true", { timeout: 90_000 });
  await expect(result).toContainText("KML: shown on the map in blue.");
  test.info().annotations.push({
    type: "result lines",
    description: (await result.locator(".muted").allTextContents()).join(" | "),
  });

  await page.locator("details.developer").evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download session observations" }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8")) as {
    observations: Record<string, unknown>[];
  };
  const record = exported.observations.find(
    (observation) => observation["kind"] === "result" && observation["outputId"] === "RESULT",
  );
  test.info().annotations.push({ type: "result record", description: JSON.stringify(record) });
  expect(record).toMatchObject({ parsedAs: "kml", crsFrom: "kml" });
});

test("ZOO's raw KML, labelled JSON, is sniffed and said to be the KML that was asked for", async () => {
  test.setTimeout(120_000);
  await requireService(`${ZOO}/`, "ZOO :5090");
  // The web app reads XML with the browser's DOMParser; in Node, jsdom's, as
  // the unit tests do.
  // jsdom ships no types, and this is the one thing used from it.
  const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
    JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser } };
  };
  globalThis.DOMParser = new JSDOM("").window.DOMParser;
  const client = createClient({ baseUrl: ZOO });
  const description = await client.getProcess("SAGA.garden_fractals.1");
  const asked = formatsToAsk(description.outputs);
  const execution = await client.execute("SAGA.garden_fractals.1", {
    inputs: { TYPE: "Lines", ANGLE: 55, MINSIZE: 30 },
    outputs: outputSelection(description, [], asked),
    response: "raw",
    description,
  });
  if (execution.kind !== "immediate") throw new Error(`expected an answer, got ${execution.kind}`);
  const [result] = await toRenderable(execution.response, {
    outputIds: description.outputs.map((output) => output.id),
    processId: description.id,
    askedFormats: asked,
    base64Outputs: base64Outputs(description, asked),
  });
  if (result === undefined) throw new Error("no result");
  test.info().annotations.push({
    type: "label and result",
    description: `${execution.response.headers.get("content-type") ?? ""} → ${result.kind}`,
  });
  expect(result).toMatchObject({ sniffed: { kind: "kml" }, geo: { ok: true, parsedAs: "kml" } });
  expect(formatSentLine(result.asked, result.received, arrivedAs(result))).toBe(
    "Labelled as JSON, but it's the KML that was asked for.",
  );
});
