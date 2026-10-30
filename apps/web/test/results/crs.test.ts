/**
 * #F1: the three coordinate systems this page places, in every spelling, and
 * RD New to CRS84 against PDOK's own answers for the same buildings.
 */

import { describe, expect, it } from "vitest";
import {
  epsgCodeOf,
  knownCrs,
  mapGeoJsonPositions,
  placeGeoJson,
  readContentCrs,
  toCrs84,
} from "../../src/results/crs.js";
import { plotStatus } from "../../src/results/plottable.js";
import { toRenderable } from "../../src/results/renderable.js";
import { placementWords } from "../../src/app/placement-words.js";
import { resultObservations } from "../../src/observations.js";
import { envelopeOf, jsonOf } from "./http-fixtures.js";

describe("knownCrs", () => {
  it.each([
    ["http://www.opengis.net/def/crs/OGC/1.3/CRS84", "CRS84"],
    ["https://www.opengis.net/def/crs/OGC/1.3/CRS84", "CRS84"],
    ["urn:ogc:def:crs:OGC:1.3:CRS84", "CRS84"],
    ["urn:ogc:def:crs:OGC::CRS84", "CRS84"],
    ["OGC:CRS84", "CRS84"],
    ["CRS84", "CRS84"],
    ["EPSG:4326", "EPSG:4326"],
    ["urn:ogc:def:crs:EPSG::4326", "EPSG:4326"],
    ["urn:ogc:def:crs:EPSG:6.6:4326", "EPSG:4326"],
    ["http://www.opengis.net/def/crs/EPSG/0/4326", "EPSG:4326"],
    ["https://www.opengis.net/def/crs/EPSG/0/4326", "EPSG:4326"],
    ["http://www.opengis.net/gml/srs/epsg.xml#4326", "EPSG:4326"],
    ["EPSG:28992", "EPSG:28992"],
    ["urn:ogc:def:crs:EPSG::28992", "EPSG:28992"],
    ["http://www.opengis.net/def/crs/EPSG/0/28992", "EPSG:28992"],
    ["https://www.opengis.net/def/crs/EPSG/0/28992", "EPSG:28992"],
    ["http://www.opengis.net/gml/srs/epsg.xml#28992", "EPSG:28992"],
    ["  epsg:28992  ", "EPSG:28992"],
  ])("recognises %s as %s", (uri, expected) => {
    expect(knownCrs(uri)).toBe(expected);
  });

  it.each([
    "http://www.opengis.net/def/crs/EPSG/0/4258",
    "http://www.opengis.net/def/crs/EPSG/0/3857",
    "http://www.opengis.net/def/crs/OGC/0/CRS84h",
    "EPSG:289920",
    "urn:ogc:def:crs:EPSG::28992x",
    "https://example.org/def/crs/EPSG/0/28992",
    "",
  ])("places nothing for %s", (uri) => {
    expect(knownCrs(uri)).toBeUndefined();
  });

  it("reads the code out of each spelling", () => {
    expect(epsgCodeOf("urn:ogc:def:crs:EPSG::28992")).toBe(28992);
    expect(epsgCodeOf("CRS84")).toBeUndefined();
  });

  it("takes a Content-Crs out of its angle brackets", () => {
    expect(readContentCrs("<http://www.opengis.net/def/crs/EPSG/0/28992>")).toBe(
      "http://www.opengis.net/def/crs/EPSG/0/28992",
    );
    expect(readContentCrs("<>")).toBeUndefined();
  });
});

/** Metres between two CRS84 positions, close together. */
function metres([lon1 = 0, lat1 = 0]: readonly number[], [lon2 = 0, lat2 = 0]: readonly number[]) {
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.hypot(x, y) * 6_371_008.8;
}

interface Feature {
  readonly id: string;
  readonly ring: readonly (readonly number[])[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRing(value: unknown): value is readonly (readonly number[])[] {
  return (
    Array.isArray(value) &&
    value.every(
      (position: unknown) =>
        Array.isArray(position) && position.every((n: unknown) => typeof n === "number"),
    )
  );
}

/** Each building's outer ring, by id, from a PDOK BAG capture. */
function buildings(key: string): Map<string, Feature> {
  const body = jsonOf(key);
  const out = new Map<string, Feature>();
  const features = isRecord(body) ? body["features"] : undefined;
  if (!Array.isArray(features)) return out;
  for (const feature of features as unknown[]) {
    if (!isRecord(feature) || !isRecord(feature["geometry"])) continue;
    const id = feature["id"];
    const coordinates = feature["geometry"]["coordinates"];
    const ring: unknown = Array.isArray(coordinates) ? (coordinates as unknown[])[0] : undefined;
    if (typeof id === "string" && isRing(ring)) out.set(id, { id, ring });
  }
  return out;
}

describe("RD New to CRS84", () => {
  it("lands within 1 mm of PDOK's own CRS84 answer for the same buildings", async () => {
    // PDOK serves BAG in EPSG:28992 and in CRS84; the two captures share their
    // buildings. 0.18 mm was the largest difference over 600 buildings in six
    // areas (step zero): the RD values' own rounding to the millimetre. The
    // official RDNAPTRANS™ grid transformation can differ from this
    // seven-parameter one by decimetres; PDOK uses the seven-parameter one.
    const rd = buildings("pdok/bag-pand-items-epsg28992.http");
    const crs84 = buildings("pdok/bag-pand-items-default-page.http");
    const convert = await toCrs84("EPSG:28992");
    let compared = 0;
    for (const [id, building] of rd) {
      const reference = crs84.get(id);
      if (reference === undefined) continue;
      building.ring.forEach((position, index) => {
        const expected = reference.ring[index];
        if (expected === undefined) throw new Error(`vertex ${String(index)} of ${id} missing`);
        expect(metres(convert(position), expected)).toBeLessThan(0.001);
        compared += 1;
      });
    }
    expect(compared).toBeGreaterThan(20);
  });

  it("keeps a height, and swaps EPSG:4326 to longitude first", async () => {
    const rd = await toCrs84("EPSG:28992");
    expect(rd([155000, 463000, 12])[2]).toBe(12);
    const swap = await toCrs84("EPSG:4326");
    expect(swap([52.1, 5.1])).toEqual([5.1, 52.1]);
  });
});

describe("mapGeoJsonPositions", () => {
  it("converts geometry positions only, and keeps properties and bbox as sent", () => {
    const value = {
      type: "FeatureCollection",
      bbox: [1, 2, 3, 4],
      features: [
        {
          type: "Feature",
          properties: { coordinates: [9, 9] },
          geometry: {
            type: "GeometryCollection",
            geometries: [
              { type: "Point", coordinates: [1, 2] },
              {
                type: "MultiPolygon",
                coordinates: [
                  [
                    [
                      [1, 2],
                      [3, 4],
                      [1, 2],
                    ],
                  ],
                ],
              },
            ],
          },
        },
      ],
    };
    const doubled = mapGeoJsonPositions(value, (position) => position.map((n) => n * 2));
    expect(doubled).toEqual({
      type: "FeatureCollection",
      bbox: [1, 2, 3, 4],
      features: [
        {
          type: "Feature",
          properties: { coordinates: [9, 9] },
          geometry: {
            type: "GeometryCollection",
            geometries: [
              { type: "Point", coordinates: [2, 4] },
              {
                type: "MultiPolygon",
                coordinates: [
                  [
                    [
                      [2, 4],
                      [6, 8],
                      [2, 4],
                    ],
                  ],
                ],
              },
            ],
          },
        },
      ],
    });
  });

  it("leaves a value that is not GeoJSON as it is", () => {
    const value = { type: "Thing", coordinates: [1, 2] };
    expect(mapGeoJsonPositions(value, () => [0, 0])).toBe(value);
  });
});

describe("placeGeoJson", () => {
  const point = { type: "Point", coordinates: [52.1, 5.1] };

  it("says nothing was named when there is no Content-Crs", async () => {
    expect(await placeGeoJson(point, undefined, "content-crs")).toEqual({ kind: "as-sent" });
  });

  it("names a CRS it does not place, and places nothing", async () => {
    expect(
      await placeGeoJson(point, "http://www.opengis.net/def/crs/EPSG/0/4258", "content-crs"),
    ).toEqual({
      kind: "other",
      uri: "http://www.opengis.net/def/crs/EPSG/0/4258",
      from: "content-crs",
    });
  });

  it("swaps EPSG:4326, and keeps the value it was given as it was", async () => {
    const placed = await placeGeoJson(point, "urn:ogc:def:crs:EPSG::4326", "content-crs");
    expect(placed).toMatchObject({ kind: "swapped", value: { coordinates: [5.1, 52.1] } });
    expect(point.coordinates).toEqual([52.1, 5.1]);
  });
});

describe("a raw response in RD New, with its Content-Crs", () => {
  const RD = "pdok/bag-pand-items-epsg28992.http";

  it("is reprojected and plotted, shown as sent, said, and recorded", async () => {
    const [result] = await toRenderable(envelopeOf(RD, "https://example.org/items"), {
      outputIds: ["buildings"],
      processId: "p",
    });
    if (result?.kind !== "json") throw new Error(`expected json, got ${String(result?.kind)}`);
    // Shown as the server sent it: metres.
    expect(JSON.stringify(result.value)).toContain("136678.911");
    const status = plotStatus(result);
    expect(status.kind).toBe("plotted");
    expect(placementWords(status, result.placement)).toBe(
      "Its coordinates are in RD New (EPSG:28992), as its Content-Crs says: reprojected to longitude and latitude to put it on the map.",
    );
    const [record] = resultObservations(
      {
        runId: "r",
        endpoint: "https://example.org",
        processId: "p",
        declaredTransmission: ["value"],
        linkOutputs: [],
      },
      [result],
    );
    expect(record).toMatchObject({
      contentCrs: "http://www.opengis.net/def/crs/EPSG/0/28992",
      axisSwapped: false,
      sourceCrs: "EPSG:28992",
      crsFrom: "content-crs",
      reprojected: true,
    });
  });

  it("is not plotted without its Content-Crs, and says the service did not say", async () => {
    const envelope = envelopeOf(RD, "https://example.org/items");
    envelope.headers.delete("content-crs");
    const [result] = await toRenderable(
      { ...envelope, contentCrs: undefined },
      { outputIds: ["buildings"], processId: "p" },
    );
    if (result === undefined) throw new Error("no result");
    const status = plotStatus(result);
    expect(status.kind).toBe("crs-unstated");
    expect(placementWords(status, undefined)).toContain(
      "the service didn't say which coordinate system they are in",
    );
    const [record] = resultObservations(
      {
        runId: "r",
        endpoint: "https://example.org",
        processId: "p",
        declaredTransmission: ["value"],
        linkOutputs: [],
      },
      [result],
    );
    expect(record).not.toHaveProperty("sourceCrs");
    expect(record).not.toHaveProperty("reprojected");
  });

  it("does not apply a response's Content-Crs to the outputs inside a results document", async () => {
    const rd = { type: "Point", coordinates: [155000, 463000] };
    const body = JSON.stringify({ a: { value: rd }, b: { value: rd } });
    const envelope = envelopeOf(RD, "https://example.org/items");
    const document = {
      ...envelope,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
    };
    const results = await toRenderable(document, { outputIds: ["a", "b"], processId: "p" });
    expect(results.map((result) => plotStatus(result).kind)).toEqual([
      "crs-unstated",
      "crs-unstated",
    ]);
  });
});
