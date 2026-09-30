/**
 * What goes on the wire, byte for byte: form values through the encoder and
 * the core's own request builder, against the committed process descriptions
 * (findings 0051, 0052, 0059).
 *
 * The bodies are written out as strings on purpose. An object comparison
 * would pass for members in any order and for `undefined` members that
 * `JSON.stringify` drops; a server receives the string.
 */

import { buildRequest, type ProcessDescription } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { runRequest } from "../../src/app/run.js";
import { CRS84 } from "../../src/forms/crs.js";
import type { FormValues } from "../../src/forms/encode.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { describeProcess, fixtureProcess } from "./helpers.js";

function wire(process: ProcessDescription, values: FormValues, mode: "sync" | "async" = "sync") {
  const { inputs, outputs } = runRequest(process, resolveFormPlan(process), values);
  const request = buildRequest("http://localhost:5080/processes", process.id, {
    inputs,
    outputs,
    mode,
    description: process,
  });
  return { body: request.body, headers: request.headers };
}

/** The request sent at plugfest 1, as the form fills it in. */
const PLUGFEST_POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [4.248652, 52.172447],
      [4.248652, 51.691133],
      [4.594165, 51.691133],
      [4.594165, 52.172447],
      [4.248652, 52.172447],
    ],
  ],
};

describe("objects are qualified values (finding 0052)", () => {
  it("sends the plugfest polygon wrapped, with the GeoJSON media type its description earns", () => {
    const rotate = fixtureProcess("pygeoapi/breinstein-rotate");
    const { body } = wire(rotate, { polygon: { geojson: JSON.stringify(PLUGFEST_POLYGON) } });
    // The plugfest body, plus `mediaType`: the input is described as
    // `format: geojson-polygon`.
    expect(body).toBe(
      '{"inputs":{"polygon":{"value":{"type":"Polygon","coordinates":[[[4.248652,52.172447],[4.248652,51.691133],[4.594165,51.691133],[4.594165,52.172447],[4.248652,52.172447]]]},"mediaType":"application/geo+json"}},"outputs":{"rotated":{}}}',
    );
  });

  it("sends a geometry described by a $ref to the Features GeoJSON schema the same way", () => {
    const inputs = fixtureProcess("pygeoapi/breinstein-inputs");
    const point = { type: "Point", coordinates: [5.1, 52.1] };
    const { body } = wire(inputs, { area: { geojson: JSON.stringify(point) } });
    expect(body).toBe(
      '{"inputs":{"area":{"value":{"type":"Point","coordinates":[5.1,52.1]},"mediaType":"application/geo+json"}},"outputs":{"echo":{},"summary":{}}}',
    );
  });

  it("keeps strings, numbers, booleans and arrays bare", () => {
    const inputs = fixtureProcess("pygeoapi/breinstein-inputs");
    const { body } = wire(inputs, {
      label: "plugfest",
      count: "3",
      ratio: "0.25",
      colour: "green",
      enabled: true,
      tags: ["a", "b"],
    });
    expect(body).toBe(
      '{"inputs":{"label":"plugfest","count":3,"ratio":0.25,"colour":"green","enabled":true,"tags":["a","b"]},"outputs":{"echo":{},"summary":{}}}',
    );
  });

  it("sends what the raw JSON editor holds exactly as typed, bare object included", () => {
    const process = describeProcess({
      settings: { schema: { oneOf: [{ type: "string" }, { type: "number" }] } },
    });
    const { body } = wire(process, { settings: { rawJson: '{"k": 1}' } });
    expect(body).toBe('{"inputs":{"settings":{"k":1}},"outputs":{}}');
  });
});

describe("bounding boxes always carry their CRS (finding 0051)", () => {
  it("sends a typed box in CRS84 when the process offers it", () => {
    const bbox = fixtureProcess("pygeoapi/breinstein-bbox");
    const { body } = wire(bbox, { bbox: { coordinates: [4.8, 52.3, 5, 52.4], crs: CRS84 } });
    expect(body).toBe(
      `{"inputs":{"bbox":{"bbox":[4.8,52.3,5,52.4],"crs":"${CRS84}"}},"outputs":{"feature":{}}}`,
    );
  });

  it("starts a bare box in CRS84 when that is offered, even under another declared default", () => {
    const process = describeProcess({
      extent: {
        schema: {
          type: "object",
          required: ["bbox"],
          properties: {
            bbox: { type: "array", items: { type: "number" } },
            crs: {
              type: "string",
              enum: ["http://www.opengis.net/def/crs/EPSG/0/4326", CRS84],
              default: "http://www.opengis.net/def/crs/EPSG/0/4326",
            },
          },
        },
      },
    });
    const { body } = wire(process, { extent: [4.8, 52.3, 5, 52.4] });
    expect(body).toBe(
      `{"inputs":{"extent":{"bbox":[4.8,52.3,5,52.4],"crs":"${CRS84}"}},"outputs":{}}`,
    );
  });

  it("uses the declared CRS where CRS84 is not offered, latitude first for EPSG:4326", () => {
    // ZOO's echo input `c` lists two EPSG CRSs and no CRS84.
    const echo = fixtureProcess("zoo-project/echo");
    const { body } = wire(echo, { c: [5.118, 52.089, 5.124, 52.093] });
    expect(JSON.parse(body)).toMatchObject({
      inputs: { c: { bbox: [52.089, 5.118, 52.093, 5.124], crs: "urn:ogc:def:crs:EPSG:6.6:4326" } },
    });
  });
});

describe("Prefer follows the user's choice, not jobControlOptions (finding 0059)", () => {
  it("asks for async on a process that declares sync only, when the user chose async", () => {
    // Not pygeoapi's `breinstein-sync-only`: pygeoapi describes it with both
    // modes, which is finding 0059 itself. No `jobControlOptions` at all means
    // sync only (§7.10).
    const syncOnly = describeProcess({}, "sync-only");
    expect(syncOnly.execution.async).toBe(false);
    expect(wire(syncOnly, {}, "async").headers).toEqual({
      "Content-Type": "application/json",
      Accept: "*/*",
      Prefer: "respond-async",
    });
  });

  it("sends no Prefer for a synchronous run", () => {
    const process = fixtureProcess("pygeoapi/breinstein-inputs");
    expect(wire(process, {}, "sync").headers).toEqual({
      "Content-Type": "application/json",
      Accept: "*/*",
    });
  });
});
