/**
 * #15: a shape's size, as the longer side of its bounding box measured on the
 * earth, said the way a visitor checks a limit against it.
 */

import { describe, expect, it } from "vitest";
import {
  distanceMetres,
  extentOfBbox,
  extentOfGeoJson,
  metresAcross,
  sizeLabel,
  sizeOfGeoJsonText,
} from "../../src/app/shape-size.js";

/** The review's box over Amsterdam, which pygeoapi measured as 3738 m across. */
const AMSTERDAM = {
  type: "Polygon",
  coordinates: [
    [
      [4.885, 52.36],
      [4.94, 52.36],
      [4.94, 52.38],
      [4.885, 52.38],
      [4.885, 52.36],
    ],
  ],
};

describe("distanceMetres", () => {
  it("is about 111 km for a degree of latitude", () => {
    expect(distanceMetres([5, 52], [5, 53]) / 1000).toBeCloseTo(111.2, 1);
  });

  it("is about 68.5 km for a degree of longitude at 52° north", () => {
    expect(distanceMetres([5, 52], [6, 52]) / 1000).toBeCloseTo(68.5, 0);
  });

  it("is nothing between a point and itself", () => {
    expect(distanceMetres([4.9, 52.37], [4.9, 52.37])).toBe(0);
  });
});

describe("metresAcross", () => {
  it("is the longer side: here east to west", () => {
    const extent = { west: 4.885, south: 52.36, east: 4.94, north: 52.38 };
    // Within a metre of what the service measured.
    expect(Math.abs(metresAcross(extent) - 3738)).toBeLessThan(5);
  });

  it("is the longer side: here south to north", () => {
    const extent = { west: 5, south: 52, east: 5.001, north: 52.01 };
    expect(metresAcross(extent)).toBeCloseTo(1112, -1);
  });
});

describe("extentOfGeoJson", () => {
  it("reads a bare geometry", () => {
    expect(extentOfGeoJson(AMSTERDAM)).toEqual({
      west: 4.885,
      south: 52.36,
      east: 4.94,
      north: 52.38,
    });
  });

  it("reads Features, FeatureCollections and GeometryCollections, all positions together", () => {
    const collection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5, 52] } },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "GeometryCollection",
            geometries: [
              {
                type: "LineString",
                coordinates: [
                  [5.1, 52.1],
                  [5.2, 52.05],
                ],
              },
            ],
          },
        },
      ],
    };
    expect(extentOfGeoJson(collection)).toEqual({ west: 5, south: 52, east: 5.2, north: 52.1 });
  });

  it("takes the first two numbers of a position with a height", () => {
    expect(extentOfGeoJson({ type: "Point", coordinates: [5, 52, 10] })).toEqual({
      west: 5,
      south: 52,
      east: 5,
      north: 52,
    });
  });

  it("has none for no positions, or numbers that are not longitude and latitude", () => {
    expect(extentOfGeoJson({ type: "Polygon", coordinates: [] })).toBeUndefined();
    expect(extentOfGeoJson({ type: "Point", coordinates: [155000, 463000] })).toBeUndefined();
    expect(extentOfGeoJson("not GeoJSON")).toBeUndefined();
    expect(extentOfGeoJson(null)).toBeUndefined();
  });
});

describe("extentOfBbox", () => {
  it("reads four numbers, longitude first", () => {
    expect(extentOfBbox([4.885, 52.36, 4.94, 52.38])).toEqual({
      west: 4.885,
      south: 52.36,
      east: 4.94,
      north: 52.38,
    });
  });

  it("reads six, with heights", () => {
    expect(extentOfBbox([4.885, 52.36, 0, 4.94, 52.38, 100])).toEqual({
      west: 4.885,
      south: 52.36,
      east: 4.94,
      north: 52.38,
    });
  });

  it("has none for a box not yet complete, or turned inside out", () => {
    expect(extentOfBbox([])).toBeUndefined();
    expect(extentOfBbox([4.885, 52.36, Number.NaN, 52.38])).toBeUndefined();
    expect(extentOfBbox([4.94, 52.36, 4.885, 52.38])).toBeUndefined();
    expect(extentOfBbox([1, 2, 3])).toBeUndefined();
  });
});

describe("sizeLabel", () => {
  it("says metres below a kilometre, in tens of metres from 100 m", () => {
    expect(sizeLabel(42.4)).toBe("About 42 m across");
    expect(sizeLabel(847)).toBe("About 850 m across");
  });

  it("says kilometres with one decimal, and none from 100 km", () => {
    expect(sizeLabel(3738)).toBe("About 3.7 km across");
    expect(sizeLabel(1000)).toBe("About 1 km across");
    expect(sizeLabel(12_345)).toBe("About 12.3 km across");
    expect(sizeLabel(123_456)).toBe("About 123 km across");
  });

  it("says kilometres from 995 m, where tens of metres would round up to 1000", () => {
    expect(sizeLabel(996)).toBe("About 1 km across");
  });

  it("has nothing to say for a point", () => {
    expect(sizeLabel(0)).toBeUndefined();
    expect(sizeLabel(Number.NaN)).toBeUndefined();
  });
});

describe("sizeOfGeoJsonText", () => {
  it("measures GeoJSON text", () => {
    expect(sizeOfGeoJsonText(JSON.stringify(AMSTERDAM))).toBe("About 3.7 km across");
  });

  it("says nothing until the text parses, and nothing for a point", () => {
    expect(sizeOfGeoJsonText("")).toBeUndefined();
    expect(sizeOfGeoJsonText('{ "type": "Polygon", "coordinates": [[[4.8')).toBeUndefined();
    expect(sizeOfGeoJsonText('{ "type": "Point", "coordinates": [4.9, 52.37] }')).toBeUndefined();
  });
});
