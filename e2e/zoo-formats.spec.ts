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
 * In the ZOO lane: reports, never blocks.
 */

import { expect, test } from "@playwright/test";
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
