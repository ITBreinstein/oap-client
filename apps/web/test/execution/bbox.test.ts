import { describe, expect, it } from "vitest";
import { bboxCrsFor, isBboxInput, toOgcBbox } from "../../src/execution/bbox.js";
import { encodeInputs } from "../../src/execution/encode-inputs.js";
import { readCapturedProcess } from "../captured-processes.js";

/** ZOO's `echo` declares `c` as `format: "ogc-bbox"` with a CRS enum. */
const bboxInput = readCapturedProcess("echo").inputs.find((input) => input.id === "c");
if (bboxInput === undefined) throw new Error("echo no longer declares the bbox input 'c'");

const SQUARE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [4.7, 52.6],
            [4.8, 52.6],
            [4.8, 52.7],
            [4.7, 52.7],
            [4.7, 52.6],
          ],
        ],
      },
    },
  ],
};

describe("recognising a bounding box", () => {
  it("finds the format on the schema itself", () => {
    expect(isBboxInput(bboxInput.schema)).toBe(true);
  });

  it("does not mistake an ordinary object input for one", () => {
    const description = readCapturedProcess("Buffer");
    const polygon = description.inputs.find((input) => input.id === "InputPolygon");
    expect(polygon && isBboxInput(polygon.schema)).toBe(false);
  });

  it("takes the CRS the input advertises", () => {
    expect(bboxCrsFor(bboxInput.schema)).toBe("urn:ogc:def:crs:EPSG:6.6:4326");
  });
});

describe("reading a box out of what the form holds", () => {
  it("takes the extent of drawn geometry", () => {
    expect(toOgcBbox(SQUARE, bboxInput.schema)).toEqual({
      bbox: [4.7, 52.6, 4.8, 52.7],
      crs: "urn:ogc:def:crs:EPSG:6.6:4326",
    });
  });

  it("accepts a bare array of four or six numbers", () => {
    expect(toOgcBbox([4.7, 52.6, 4.8, 52.7], bboxInput.schema)?.bbox).toEqual([
      4.7, 52.6, 4.8, 52.7,
    ]);
    expect(toOgcBbox([1, 2, 3, 4, 5, 6], bboxInput.schema)?.bbox).toHaveLength(6);
  });

  it("keeps a CRS the author supplied over the advertised one", () => {
    expect(
      toOgcBbox({ bbox: [1, 2, 3, 4], crs: "urn:ogc:def:crs:EPSG:6.6:3785" }, bboxInput.schema),
    ).toEqual({ bbox: [1, 2, 3, 4], crs: "urn:ogc:def:crs:EPSG:6.6:3785" });
  });

  it("reads nothing out of a value that is not geometry", () => {
    expect(toOgcBbox("somewhere near Alkmaar", bboxInput.schema)).toBeUndefined();
  });
});

describe("encoding a bounding box input", () => {
  it("sends bbox and crs directly, never wrapped in value", () => {
    const { inputs } = encodeInputs([bboxInput], { c: SQUARE });
    expect(inputs["c"]).toEqual({
      bbox: [4.7, 52.6, 4.8, 52.7],
      crs: "urn:ogc:def:crs:EPSG:6.6:4326",
    });
  });

  it("sends an unreadable value unchanged, and says why", () => {
    const { inputs, notes } = encodeInputs([bboxInput], { c: "not a box" });
    expect(inputs["c"]).toBe("not a box");
    expect(notes.join(" ")).toContain("bounding box");
  });
});
