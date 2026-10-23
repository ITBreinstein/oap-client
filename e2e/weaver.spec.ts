/**
 * The OGC API - Processes 2.0 draft, from a browser, against Weaver — the one
 * server found that declares the draft's Core class (infra/compose/weaver.yml).
 *
 * Weaver sends no CORS headers, so every test reaches it through the relay's
 * read route, after the user confirms, as ZOO is reached.
 *
 * What these tests can and cannot show, as of 2026-10-23. EchoProcess is the
 * only process this Weaver image runs: the other builtins fail on a Python
 * interpreter the image does not have. And Weaver refuses, with a 422, the
 * request a form generated from EchoProcess's own description sends:
 * `arrayInput` and `geometryInput` declare `maxOccurs` above 1 *and* an array
 * schema, which the draft's cardinality rules make arrays of arrays, and
 * Weaver accepts them only flat. So no run started from the form succeeds
 * here. What is tested is what the client controls: the version chosen, the
 * request sent in that version's form, and the server's answer shown and
 * recorded, whatever it is.
 *
 * Named and never blocking (`pnpm test:e2e:weaver`). Under CI a Weaver that
 * is not answering fails the lane rather than skipping it.
 */

import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { requireService } from "./services.js";
import { RELAY } from "./servers.js";

const WEAVER = "http://localhost:5100";

const OUTPUTS = [
  "stringOutput",
  "measureOutput",
  "dateOutput",
  "doubleOutput",
  "arrayOutput",
  "complexObjectOutput",
  "geometryOutput",
  "boundingBoxOutput",
  "imagesOutput",
  "featureCollectionOutput",
];

interface ExportedObservation {
  readonly kind: string;
  readonly [key: string]: unknown;
}

test.beforeEach(async ({ page }) => {
  await requireService(`${WEAVER}/conformance`, "Weaver :5100");
  await page.goto("/?developer");
});

/**
 * Connect to Weaver as the relay endpoint, by its key, through the read route.
 * Not the preset of the same address: a typed or preset address is reached
 * directly, and the relay is offered only for a relay endpoint.
 */
async function connect(page: Page, entry: RegExp = /^weaver /): Promise<void> {
  await page.getByRole("radio", { name: entry }).check();
  await page.getByRole("button", { name: "Connect" }).click();
  const offer = page.getByTestId("relay-offer");
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.getByRole("button", { name: /^(Use relay|Open)$/ }).click();
  await expect(page.getByTestId("relay-banner")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "EchoProcess", exact: true }).click();
  await expect(page.getByRole("heading", { name: "EchoProcess" })).toBeVisible();
}

/** Every required input, as a person would fill it, JSON where the form asks for JSON. */
async function fill(page: Page): Promise<void> {
  const form = page.getByRole("form", { name: "EchoProcess" });
  await form.getByRole("combobox", { name: "stringInput (required)" }).selectOption("Value1");
  await form
    .getByRole("textbox", { name: "Numerical Value with UOM Example (required)" })
    .fill("9.81");
  await form
    .getByRole("textbox", { name: "Date Literal Input Example (required) Date" })
    .fill("2026-10-23");
  await form.getByRole("textbox", { name: "Time", exact: true }).fill("12:00");
  await form
    .getByRole("textbox", { name: "Bounded Double Literal Input Example (required)" })
    .fill("5");
  // Two values of two items each: `minOccurs: 2`, and the array schema's
  // `minItems: 2`. Each list's own "Add a value" comes last in it.
  await twoByTwo(page, "Array Input Example", ["1", "2", "3", "4"]);
  await form
    .getByRole("textbox", { name: "Complex Object Input Example (required)" })
    .fill('{"value": {"property1": "e2e", "property5": true}, "mediaType": "application/json"}');
  const point =
    '{"value": {"type": "Point", "coordinates": [5, 52]}, "mediaType": "application/json"}';
  await twoByTwo(page, "Geometry input", [point, point, point, point]);
  await form
    .getByRole("textbox", { name: "Bounding Box Input Example (required)" })
    .fill('{"bbox": [4, 52, 5, 53]}');
  await form
    .getByRole("textbox", { name: "Inline Images Value Input, value 1" })
    .fill(
      '{"value": "SUkqAAgAAAA=", "mediaType": "image/tiff; application=geotiff", "encoding": "base64"}',
    );
  await form
    .getByRole("textbox", { name: "Feature Collection Input Example (required)" })
    .fill(
      '{"value": {"type": "FeatureCollection", "features": []}, "mediaType": "application/json"}',
    );
}

/** A list of lists, filled two by two, in reading order. */
async function twoByTwo(page: Page, title: string, values: readonly string[]): Promise<void> {
  const outer = page.getByRole("group", { name: `${title} (required)` });
  await outer.getByRole("button", { name: "Add a value" }).last().click();
  for (const at of [1, 2]) {
    const item = outer.getByRole("listitem").filter({
      has: page.getByText(`${title}, value ${String(at)}`, { exact: true }),
    });
    await item.getByRole("button", { name: "Add a value" }).first().click();
  }
  let next = 0;
  for (const at of [1, 2]) {
    for (const inner of [1, 2]) {
      await page
        .getByRole("textbox", { name: `${title}, value ${String(at)}, value ${String(inner)}` })
        .fill(values[next] ?? "");
      next += 1;
    }
  }
}

/** The execute the page sends, through the relay, and its body. */
function executeSent(page: Page): Promise<Request> {
  return page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().startsWith(RELAY) &&
      request.url().includes("EchoProcess"),
  );
}

async function observations(page: Page): Promise<ExportedObservation[]> {
  const developer = page.locator("details.developer");
  if ((await developer.getAttribute("open")) === null) {
    await developer.locator("summary").click();
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download session observations" }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8")) as {
    observations: ExportedObservation[];
  };
  return exported.observations;
}

test.describe("Weaver, the 2.0 draft", () => {
  test("is spoken to as the draft, because it declares it", async ({ page }) => {
    await connect(page);
    await expect(page.getByTestId("protocol-version")).toHaveText(
      "Speaking OGC API - Processes 2.0 (draft): the service declares 1.0 and 2.0.",
    );
    // The draft has no transmissionMode: Link is off, and says why.
    await expect(page.getByTestId("no-link-reason")).toHaveText(
      "This service's version of the standard doesn't let the page ask for a link instead of the data.",
    );
    for (const id of OUTPUTS) {
      const choice = page.locator(`[data-output-choice="${id}"]`);
      await expect(choice.getByRole("radio", { name: "Link" })).toBeDisabled();
      await expect(choice.getByRole("radio", { name: "Value" })).toBeChecked();
    }
  });

  test("a run sends the draft's request, and Weaver's answer is shown and recorded", async ({
    page,
  }) => {
    await connect(page);
    await fill(page);
    const sent = executeSent(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const body = (await sent).postDataJSON() as Record<string, unknown>;

    // Nothing extra: no response member, every output as the server prefers.
    expect(body).not.toHaveProperty("response");
    expect(body["outputs"]).toEqual(Object.fromEntries(OUTPUTS.map((id) => [id, {}])));
    // The draft's arrays of arrays, for an input with maxOccurs above 1 and an array schema.
    expect((body["inputs"] as Record<string, unknown>)["arrayInput"]).toEqual([
      [1, 2],
      [3, 4],
    ]);

    // Weaver refuses that shape (422). The page says the service reported an error.
    await expect(page.getByText("The service reported an error.")).toBeVisible({
      timeout: 60_000,
    });
    const execution = (await observations(page)).find((entry) => entry.kind === "execution");
    expect(execution).toMatchObject({
      protocolVersion: "2.0-draft",
      versionSource: "declared",
      requestedMode: "sync",
      status: 422,
      outcome: "error",
    });
  });

  test("a background run is asked for with respond-async alone, as in 1.0", async ({ page }) => {
    await connect(page);
    await fill(page);
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    const sent = executeSent(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const request = await sent;
    expect(await request.headerValue("prefer")).toBe("respond-async");
    expect(request.postDataJSON()).not.toHaveProperty("response");

    await expect(page.getByText("The service reported an error.")).toBeVisible({
      timeout: 60_000,
    });
    const execution = (await observations(page)).find((entry) => entry.kind === "execution");
    expect(execution).toMatchObject({
      protocolVersion: "2.0-draft",
      requestedMode: "async",
      status: 422,
    });
  });
});

test.describe("Weaver, pinned to 1.0 in config.json", () => {
  test.beforeEach(async ({ page }) => {
    // The lane's own config.json, with a preset that pins Weaver's address.
    await page.route("**/config.json", (route) =>
      route.fulfill({
        json: {
          relay: { url: RELAY },
          presets: [{ title: "Weaver as 1.0", url: WEAVER, protocolVersion: "1.0" }],
        },
      }),
    );
    await page.goto("/?developer");
  });

  test("is spoken to as 1.0, and a link is asked for 1.0's way", async ({ page }) => {
    await connect(page);
    await expect(page.getByTestId("protocol-version")).toHaveText(
      "Speaking OGC API - Processes 1.0: pinned in config.json.",
    );
    await expect(page.getByTestId("no-link-reason")).toHaveCount(0);
    await fill(page);
    await page
      .locator('[data-output-choice="stringOutput"]')
      .getByRole("radio", { name: "Link" })
      .check();
    const sent = executeSent(page);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const body = (await sent).postDataJSON() as Record<string, unknown>;
    expect((body["outputs"] as Record<string, unknown>)["stringOutput"]).toEqual({
      transmissionMode: "reference",
    });

    await expect(page.getByText("The service reported an error.")).toBeVisible({
      timeout: 60_000,
    });
    const execution = (await observations(page)).find((entry) => entry.kind === "execution");
    expect(execution).toMatchObject({ protocolVersion: "1.0", versionSource: "configured" });
  });
});

/** A map style with nothing to fetch, standing in for OpenFreeMap's, as in a11y.spec.ts. */
const WORLD_STAND_IN = {
  version: 8,
  sources: {},
  layers: [{ id: "land", type: "background", paint: { "background-color": "#f8f4f0" } }],
};

test.describe("Weaver's form, as the draft has it, with axe", () => {
  for (const style of ["instrument", "instrument-updated"]) {
    for (const theme of ["light", "dark"]) {
      test(`has no violations with Link off and its reason (${style}, ${theme})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.route("https://tiles.openfreemap.org/**", (route) =>
          route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`/?style=${style}&theme=${theme}`);
        // The updated Instrument names a relay endpoint by its service's title.
        await connect(page, style === "instrument-updated" ? /^Weaver http/ : /^weaver /);
        const reason = page.getByTestId("no-link-reason");
        await reason.scrollIntoViewIfNeeded();
        await expect(reason).toBeVisible();
        if (style === "instrument-updated" && theme === "light") {
          await page.screenshot({ path: "test-results/v2-formats/phase1/link-off-on-draft.png" });
        }
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(
          violations.map((violation) => `${violation.id}: ${violation.nodes.length} nodes`),
        ).toEqual([]);
      });
    }
  }
});
