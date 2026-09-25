/**
 * Which results go on the map: GeoJSON in degrees, whatever it is wrapped in
 * and whatever media type it came with, and nothing else.
 */

import { describe, expect, it } from "vitest";
import { plotStatus, plottedShapes } from "../../src/results/plottable.js";
import type { RenderableResult } from "../../src/results/renderable.js";

const square = [
  [
    [5, 52],
    [5.1, 52],
    [5.1, 52.1],
    [5, 52.1],
    [5, 52],
  ],
];

const json = (outputId: string, value: unknown): RenderableResult => ({
  kind: "json",
  outputId,
  value,
});

describe("plotStatus", () => {
  it("plots a bare geometry, as pygeoapi's geo+json output sends it", () => {
    expect(plotStatus(json("rotated", { type: "Polygon", coordinates: square }))).toEqual({
      kind: "plotted",
      shapes: [{ type: "Polygon", coordinates: square }],
    });
  });

  it("plots a FeatureCollection, as ZOO's Buffer sends it under a plain JSON type", () => {
    const collection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: square } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5, 52] } },
      ],
    };
    const status = plotStatus(json("Result", collection));
    expect(status.kind).toBe("plotted");
    expect(status.kind === "plotted" ? status.shapes.map((shape) => shape.type) : []).toEqual([
      "Polygon",
      "Point",
    ]);
  });

  it("does not plot JSON that is not GeoJSON, or GeoJSON with no geometry", () => {
    expect(plotStatus(json("echo", { label: "a" })).kind).toBe("not-geojson");
    expect(plotStatus(json("echo", [1, 2])).kind).toBe("not-geojson");
    expect(plotStatus(json("empty", { type: "FeatureCollection", features: [] })).kind).toBe(
      "not-geojson",
    );
  });

  it("does not plot text or a download, even when it holds GeoJSON", () => {
    const text: RenderableResult = {
      kind: "text",
      outputId: "t",
      value: JSON.stringify({ type: "Point", coordinates: [5, 52] }),
      mediaType: "text/plain",
    };
    expect(plotStatus(text).kind).toBe("not-geojson");
  });

  it("says a geometry in projected coordinates is not plotted, rather than misplacing it", () => {
    const rd = { type: "Point", coordinates: [155000, 463000] };
    expect(plotStatus(json("rd", rd))).toEqual({ kind: "projected" });
  });
});

describe("plottedShapes", () => {
  it("collects every plotted result's shapes, in output order", () => {
    const shapes = plottedShapes([
      json("first", { type: "Point", coordinates: [5, 52] }),
      json("echo", { label: "not geojson" }),
      json("second", { type: "Polygon", coordinates: square }),
    ]);
    expect(shapes.map((shape) => shape.type)).toEqual(["Point", "Polygon"]);
  });
});
