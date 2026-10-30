/**
 * #F5: KML read for the map. HTML in a description stays text, here and on
 * screen; ExtendedData's Data and SchemaData become properties; heights are
 * left out. From `breinstein-kml` and ZOO's own KML, labelled JSON.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { FeatureProperties } from "../../src/app/FeatureProperties.js";
import { formatSentLine, arrivedAs } from "../../src/results/format-choice.js";
import { readKml } from "../../src/results/kml.js";
import { plottedFeatures, plotStatus } from "../../src/results/plottable.js";
import { toRenderable } from "../../src/results/renderable.js";
import { parseXml } from "../../src/results/xml.js";
import { resultObservations } from "../../src/observations.js";
import { envelopeOf } from "./http-fixtures.js";

async function breinsteinKml() {
  const [result] = await toRenderable(
    envelopeOf("pygeoapi/execution/breinstein-kml.http", "http://localhost:5080/x"),
    { outputIds: ["placemarks"], processId: "breinstein-kml" },
  );
  if (result === undefined) throw new Error("no result");
  return result;
}

describe("breinstein-kml, labelled KML", () => {
  it("reads four Placemarks in a Folder, with every geometry, and drops their heights", async () => {
    const result = await breinsteinKml();
    expect(result).toMatchObject({
      kind: "text",
      geo: {
        ok: true,
        parsedAs: "kml",
        heightsDropped: true,
        placement: { kind: "crs84", from: "kml" },
      },
    });
    expect(result).not.toHaveProperty("sniffed");
    const status = plotStatus(result);
    if (status.kind !== "plotted") throw new Error(`not plotted: ${status.kind}`);
    expect(status.shapes.map((shape) => shape.type)).toEqual([
      "Polygon",
      "Point",
      "LineString",
      "Point",
      "Point",
    ]);
    expect(status.shapes[1]).toEqual({ type: "Point", coordinates: [5.121, 52.091] });
  });

  it("keeps name, description, Data and SchemaData as text properties", async () => {
    const features = plottedFeatures([await breinsteinKml()]);
    const properties = features.map((feature) =>
      feature.origin.kind === "feature" ? feature.origin.properties : undefined,
    );
    expect(properties[0]).toMatchObject({ name: "The area" });
    expect((properties[0] as Record<string, string>)["description"]).toContain(
      '<script>alert("not run")</script>',
    );
    expect(properties[1]).toEqual({ name: "Its centre", kind: "centre", note: "<b>not bold</b>" });
    expect(properties[2]).toEqual({ name: "A diagonal", length: "0.0072", unit: "degree" });
  });

  it("shows the HTML in a description as text: no element of it reaches the page", async () => {
    const [feature] = plottedFeatures([await breinsteinKml()]);
    if (feature === undefined) throw new Error("no feature");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<FeatureProperties feature={feature} onClose={() => undefined} />);
      await Promise.resolve();
    });
    expect(
      host.querySelector("script, img, h3 + h3, b, a[href='https://example.org/']"),
    ).toBeNull();
    expect(host.textContent).toContain(
      '<img src="https://example.org/tracker.png" onerror="alert(1)">',
    );
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
  });
});

describe("ZOO's KML, labelled JSON (finding 0026)", () => {
  const ASKED = "application/vnd.google-earth.kml+xml";

  async function zooKml(asked?: string) {
    const [result] = await toRenderable(
      envelopeOf(
        "zoo-project/execution/saga-fractals-raw-kml.http",
        "http://localhost:5090/ogc-api/processes/SAGA.garden_fractals.1/execution",
      ),
      {
        outputIds: ["RESULT"],
        processId: "SAGA.garden_fractals.1",
        ...(asked === undefined ? {} : { askedFormats: { RESULT: asked } }),
      },
    );
    if (result === undefined) throw new Error("no result");
    return result;
  }

  it("is sniffed by its root and read: KML is longitude and latitude, so it is plotted", async () => {
    const result = await zooKml(ASKED);
    expect(result).toMatchObject({
      kind: "text",
      mediaType: ASKED,
      sniffed: { kind: "kml", declaredMediaType: "application/json;charset=UTF-8" },
      asked: ASKED,
      received: "application/json",
    });
    expect(plotStatus(result).kind).toBe("plotted");
  });

  it("says it is the KML that was asked for, under the wrong label, and claims no other format", async () => {
    const result = await zooKml(ASKED);
    expect(formatSentLine(result.asked, result.received, arrivedAs(result))).toBe(
      "Labelled as JSON, but it's the KML that was asked for.",
    );
  });

  it("says what it is when nothing was asked", async () => {
    const result = await zooKml();
    expect(formatSentLine(result.asked, result.received, arrivedAs(result))).toBe(
      "Labelled as JSON, but it is KML.",
    );
  });

  it("is recorded with its label, what it was read as, and that it was sniffed", async () => {
    const [record] = resultObservations(
      {
        runId: "r",
        endpoint: "http://localhost:5090/ogc-api",
        processId: "SAGA.garden_fractals.1",
        declaredTransmission: ["value"],
        linkOutputs: [],
        formatsAsked: { RESULT: ASKED },
      },
      [await zooKml(ASKED)],
    );
    expect(record).toMatchObject({
      mediaType: "application/json;charset=UTF-8",
      declaredMediaType: "application/json;charset=UTF-8",
      parsedAs: "kml",
      sniffed: true,
      sourceCrs: "CRS84",
      crsFrom: "kml",
      contentCrs: undefined,
    });
  });
});

describe("what KML refuses or leaves out", () => {
  function read(body: string) {
    const parsed = parseXml(
      `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`,
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    return readKml(parsed.root);
  }

  it("keeps a Placemark it cannot draw, with its properties and no geometry", () => {
    const result = read(
      '<Placemark><name>A track</name><gx:Track xmlns:gx="http://www.google.com/kml/ext/2.2"/></Placemark>',
    );
    expect(result).toMatchObject({
      ok: true,
      geojson: { features: [{ properties: { name: "A track" }, geometry: null }] },
    });
  });

  it("reads a MultiGeometry as a collection, and a polygon's holes", () => {
    const ring = "<LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing>";
    const result = read(
      `<Placemark><MultiGeometry><Polygon><outerBoundaryIs>${ring}</outerBoundaryIs><innerBoundaryIs>${ring}</innerBoundaryIs></Polygon><Point><coordinates>2, 3</coordinates></Point></MultiGeometry></Placemark>`,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.geojson.features[0]?.geometry).toMatchObject({
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        { type: "Point", coordinates: [2, 3] },
      ],
    });
    expect(result.heightsDropped).toBe(false);
  });

  it("refuses coordinates that are not longitude,latitude, with why", () => {
    expect(read("<Placemark><Point><coordinates>5;52</coordinates></Point></Placemark>")).toEqual({
      ok: false,
      reason: 'One of its coordinates, "5;52", is not longitude,latitude.',
    });
  });
});
