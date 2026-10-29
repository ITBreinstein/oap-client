/**
 * GeoJSON inputs described as the Beleidsnormen API describes them, against
 * `breinstein-area-what-if` on the local pygeoapi, which copies its shapes:
 * an area that is a `oneOf` of Polygon and MultiPolygon (#G2), and a
 * repeatable FeatureCollection of points told by its structure alone (#G3),
 * drawn one row at a time (3.4). And the standard's own `geometryInput`, GeoJSON
 * among text encodings (#G2b), put on that process's area input.
 *
 * No test here reaches the Beleidsnormen API: it sends no CORS headers, and
 * it is another party's dev server.
 */

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const STYLES = ["instrument", "instrument-updated"] as const;
const TITLE = "Points in an area";

/** A map style with nothing to fetch, standing in for OpenFreeMap's in the updated Instrument. */
const WORLD_STAND_IN = {
  version: 8,
  sources: {},
  layers: [{ id: "land", type: "background", paint: { "background-color": "#f8f4f0" } }],
};

async function open(page: Page, style: string, theme = "light") {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/?style=${style}&theme=${theme}`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
  const typed = page.getByRole("radio", { name: /^Another service/ });
  if (await typed.isVisible()) await typed.check();
  await page.getByRole("textbox", { name: "Service address" }).fill(PYGEOAPI);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
}

async function openProcess(page: Page) {
  await page.getByRole("button", { name: TITLE, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible();
  await page.locator(".map-pane canvas").first().waitFor();
}

/** Back to the list: "All processes" where the version shows it, else the rail's Processes. */
async function toList(page: Page) {
  const breadcrumb = page.getByRole("button", { name: "All processes" });
  await (
    (await breadcrumb.isVisible())
      ? breadcrumb
      : page.getByRole("button", { name: "Processes", exact: true })
  ).click();
  await expect(page.getByRole("heading", { level: 2, name: "Processes" })).toBeVisible();
}

/** A point on the map, as fractions of its width and height. */
async function onMap(page: Page) {
  const box = await page.locator(".map-canvas canvas").first().boundingBox();
  if (box === null) throw new Error("the map has no size");
  return (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
}

async function clickAll(page: Page, points: readonly { x: number; y: number }[]) {
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
  }
}

const tools = (page: Page) => page.getByRole("toolbar", { name: "Drawing tools" });

interface FeatureCollection {
  readonly type: string;
  readonly features: readonly { readonly geometry: { readonly type: string } }[];
}

test.beforeEach(async () => {
  await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
});

for (const style of STYLES) {
  test(`an area and two points drawn, sent in their wrappers, the points as an array, and counted (${style})`, async ({
    page,
  }) => {
    await open(page, style);
    await openProcess(page);
    const at = await onMap(page);

    // The area: a oneOf of Polygon and MultiPolygon, drawn from "Add area".
    const area = page.locator('[data-input-id="geometry"]');
    await expect(area).toHaveAttribute("data-control", "geometry");
    await area.getByRole("button", { name: "Draw on the map" }).click();
    await expect(tools(page).getByRole("button", { name: "Add area" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await clickAll(page, [at(0.4, 0.4), at(0.6, 0.4), at(0.6, 0.6), at(0.4, 0.6), at(0.4, 0.4)]);
    const areaText = area.getByRole("textbox", { name: "GeoJSON", exact: true });
    await expect(areaText).toHaveValue(/"Polygon"/);
    await area.getByRole("button", { name: "Stop drawing" }).click();

    // The points: one row of a repeatable FeatureCollection, drawn for that row.
    const points = page.locator('[data-input-id="nieuwe_punten"]');
    await expect(points).toHaveAttribute("data-control", "list");
    await points.getByRole("button", { name: "Add a value" }).click();
    await points.getByRole("button", { name: "Draw on the map, value 1" }).click();
    // The tools take the focus, as for one geometry field (#18).
    await expect(tools(page).getByRole("button", { name: "Add point" })).toBeFocused();
    // One inside the area, one outside it, clear of the map's search box.
    // A tool places one shape, then editing resumes: Add point for each.
    for (const point of [at(0.5, 0.5), at(0.75, 0.3)]) {
      await tools(page).getByRole("button", { name: "Add point" }).click();
      await clickAll(page, [point]);
    }
    const row = points.getByRole("textbox", { name: "GeoJSON, value 1" });
    const types = async () =>
      (JSON.parse((await row.inputValue()) || '{"features":[]}') as FeatureCollection).features.map(
        (feature) => feature.geometry.type,
      );
    await expect.poll(types).toEqual(["Point", "Point"]);
    const drawn = JSON.parse(await row.inputValue()) as FeatureCollection;
    await points.getByRole("button", { name: "Stop drawing, value 1" }).click();

    // Form memory (#10): the row comes back with the process. And the list
    // now knows the process needs an area.
    await toList(page);
    const listed = page.locator("li", {
      has: page.getByRole("button", { name: TITLE, exact: true }),
    });
    await expect(listed.locator('[data-needs="area"]')).toBeVisible();
    if (style === "instrument-updated") await expect(listed).toContainText("Area");
    await openProcess(page);
    await expect(row).toHaveValue(
      JSON.stringify(drawn, null, style === "instrument-updated" ? "\t" : undefined),
    );

    const drawnArea = JSON.parse(await areaText.inputValue()) as unknown;
    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/breinstein-area-what-if/execution"),
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const body = (await sent).postDataJSON() as {
      inputs: { geometry: unknown; nieuwe_punten: unknown };
    };
    expect(body.inputs.geometry).toEqual({
      value: drawnArea,
      mediaType: "application/geo+json",
    });
    // An array of one: the form every server must take
    // (/req/core/process-execute-input-array).
    expect(body.inputs.nieuwe_punten).toEqual([
      { value: drawn, mediaType: "application/geo+json" },
    ]);

    const result = page.locator('[data-output-id="result"]');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText('"points_as": "array"');
    await expect(result).toContainText('"points": 2');
    await expect(result).toContainText('"inside": 1');
  });
}

for (const style of STYLES) {
  for (const theme of ["light", "dark"] as const) {
    test(`no axe violations while a row is drawn, ${style}, ${theme}`, async ({ page }) => {
      await open(page, style, theme);
      await openProcess(page);
      const points = page.locator('[data-input-id="nieuwe_punten"]');
      await points.getByRole("button", { name: "Add a value" }).click();
      await points.getByRole("button", { name: "Add a value" }).click();
      await points.getByRole("button", { name: "Draw on the map, value 2" }).click();
      await expect(points.getByRole("button", { name: "Stop drawing, value 2" })).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
        "axe violations",
      ).toEqual([]);
    });
  }
}

/**
 * The standard's `geometryInput` (clause 8), put on the area input: no server
 * in the testbed sends it, so the description is rewritten on its way in, as
 * `workflow.spec.ts` does for ZOO's Buffer.
 */
async function asGeometryInput(page: Page) {
  await page.route(
    (url) => url.pathname === "/processes/breinstein-area-what-if",
    async (route) => {
      const response = await route.fetch();
      const description = (await response.json()) as {
        inputs: Record<string, { schema: unknown }>;
      };
      const geometry = description.inputs["geometry"];
      if (geometry !== undefined) {
        geometry.schema = {
          oneOf: [
            {
              type: "string",
              contentMediaType: "application/gml+xml; version=3.2",
              contentSchema: "http://schemas.opengis.net/gml/3.2.1/geometryBasic2d.xsd",
            },
            {
              allOf: [
                { format: "geojson-geometry" },
                {
                  $ref: "http://schemas.opengis.net/ogcapi/features/part1/1.0/openapi/schemas/geometryGeoJSON.yaml",
                },
              ],
            },
          ],
        };
      }
      await route.fulfill({ response, json: description });
    },
  );
}

for (const style of STYLES) {
  test(`the standard's geometryInput: the field names GML too, and GeoJSON is sent naming its format (${style})`, async ({
    page,
  }) => {
    await asGeometryInput(page);
    await open(page, style);
    await openProcess(page);
    const area = page.locator('[data-input-id="geometry"]');
    await expect(area).toHaveAttribute("data-control", "geometry");
    await expect(area.getByTestId("other-formats")).toHaveText(
      "The service also accepts this input as application/gml+xml; version=3.2. The page sends GeoJSON, the one format the map can make.",
    );
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [5.118, 52.089],
          [5.124, 52.089],
          [5.124, 52.093],
          [5.118, 52.089],
        ],
      ],
    };
    await area.getByRole("textbox", { name: "GeoJSON", exact: true }).fill(JSON.stringify(polygon));
    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/breinstein-area-what-if/execution"),
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    expect(((await sent).postDataJSON() as { inputs: unknown }).inputs).toEqual({
      geometry: { value: polygon, mediaType: "application/geo+json" },
    });
    await expect(page.locator('[data-output-id="result"]')).toContainText('"points_as": "absent"');
  });

  for (const theme of ["light", "dark"] as const) {
    test(`no axe violations on the geometryInput field and its note, ${style}, ${theme}`, async ({
      page,
    }) => {
      await asGeometryInput(page);
      await open(page, style, theme);
      await openProcess(page);
      await expect(page.getByTestId("other-formats")).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
        "axe violations",
      ).toEqual([]);
    });
  }
}
