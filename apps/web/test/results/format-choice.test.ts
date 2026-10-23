/**
 * #F3: the format asked for an output that offers several, in this page's
 * order, from real descriptions; and the request it goes into, which lists
 * every output whether or not it asks one a format.
 */

import { parseDescription, type OutputDescription } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { outputSelection } from "../../src/app/run.js";
import {
  formatKind,
  formatLine,
  formatSentLine,
  formatsToAsk,
  offeredFormats,
  preferredFormat,
} from "../../src/results/format-choice.js";
import weaverEcho from "../../../../packages/core/test/fixtures/weaver/processes/EchoProcess.json" with { type: "json" };
import sagaFractals from "../../../../packages/core/test/fixtures/zoo-project/processes/SAGA.garden_fractals.1.json" with { type: "json" };
import zooDisplay from "../../../../packages/core/test/fixtures/zoo-project/processes/display.json" with { type: "json" };

const weaver = parseDescription(weaverEcho, { documentUrl: "http://localhost:5100/p" }).process;
const saga = parseDescription(sagaFractals, { documentUrl: "http://localhost:5090/p" }).process;
const display = parseDescription(zooDisplay, { documentUrl: "http://localhost:5090/p" }).process;

function output(process: typeof weaver, id: string): OutputDescription {
  const found = process.outputs.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no output ${id}`);
  return found;
}

function withSchema(schema: Record<string, unknown>, multiple = false): OutputDescription {
  return {
    id: "out",
    schema,
    minOccurs: 1,
    maxOccurs: multiple ? "unbounded" : 1,
    multiple,
  };
}

function offering(...mediaTypes: (string | [string, string])[]): OutputDescription {
  return withSchema({
    oneOf: mediaTypes.map((entry) =>
      typeof entry === "string"
        ? { type: "string", contentMediaType: entry }
        : { type: "string", contentMediaType: entry[0], contentSchema: entry[1] },
    ),
  });
}

describe("formatKind", () => {
  it.each([
    ["application/geo+json", undefined, "geojson"],
    ["application/gml+xml", undefined, "gml"],
    ["application/gml+xml; version=3.2", undefined, "gml"],
    ["text/xml", "http://schemas.opengis.net/gml/3.1.0/polygon.xsd", "gml"],
    ["application/xml; subtype=gml/3.2", undefined, "gml"],
    ["text/xml", undefined, "xml"],
    ["application/xml", undefined, "xml"],
    ["application/vnd.google-earth.kml+xml", undefined, "kml"],
    ["image/tiff", undefined, "geotiff"],
    ["image/tiff; application=geotiff", undefined, "geotiff"],
    ["application/tiff; application=geotiff", undefined, "geotiff"],
    ["image/png", undefined, "image"],
    ["image/jp2", undefined, "image"],
    ["application/json", undefined, "other"],
    ["text/csv", undefined, "other"],
    ["application/vnd.google-earth.kmz", undefined, "other"],
  ])("%s (schema %s) is %s", (mediaType, contentSchema, kind) => {
    expect(formatKind(mediaType, contentSchema)).toBe(kind);
  });
});

describe("the order: GeoJSON, hinted GML, KML, unhinted XML, GeoTIFF, other images, else none", () => {
  const cases: [string, OutputDescription, string | undefined][] = [
    [
      "GeoJSON over GML and KML",
      offering(
        "application/vnd.google-earth.kml+xml",
        "application/gml+xml",
        "application/geo+json",
      ),
      "application/geo+json",
    ],
    [
      "hinted GML over KML",
      offering("application/vnd.google-earth.kml+xml", [
        "text/xml",
        "http://fooa/gml/3.1.0/polygon.xsd",
      ]),
      "text/xml",
    ],
    [
      "KML over unhinted XML",
      offering("text/xml", "application/vnd.google-earth.kml+xml"),
      "application/vnd.google-earth.kml+xml",
    ],
    ["unhinted XML over GeoTIFF", offering("image/tiff", "text/xml"), "text/xml"],
    ["GeoTIFF over PNG", offering("image/png", "image/tiff"), "image/tiff"],
    ["an image over anything else", offering("text/csv", "image/png"), "image/png"],
    ["nothing when nothing can be shown", offering("text/csv", "application/json"), undefined],
    ["nothing for an output offering one format", offering("application/geo+json"), undefined],
  ];
  it.each(cases)("%s", (_, out, expected) => {
    expect(preferredFormat(offeredFormats(out))?.mediaType).toBe(expected);
  });

  it("asks Weaver's EchoProcess for GeoJSON, GeoTIFF and GeoJSON (captured 2026-10-23)", () => {
    expect(formatsToAsk(weaver.outputs)).toEqual({
      geometryOutput: "application/geo+json",
      imagesOutput: "image/tiff; application=geotiff",
      featureCollectionOutput: "application/geo+json",
    });
  });

  it("asks ZOO's SAGA vector output for KML: its XML says nothing of GML", () => {
    expect(formatsToAsk(saga.outputs)).toEqual({ RESULT: "application/vnd.google-earth.kml+xml" });
  });

  it("asks ZOO's display process for nothing: HTML and plain text are neither", () => {
    expect(formatsToAsk(display.outputs)).toEqual({});
  });

  it("writes the media type exactly as the description did", () => {
    expect(formatsToAsk([output(weaver, "imagesOutput")])["imagesOutput"]).toBe(
      "image/tiff; application=geotiff",
    );
  });
});

describe("the user's choice", () => {
  const outputs = [output(weaver, "featureCollectionOutput")];

  it("wins when it is one the output offers", () => {
    expect(
      formatsToAsk(outputs, {
        featureCollectionOutput: "application/vnd.google-earth.kml+xml",
      }),
    ).toEqual({ featureCollectionOutput: "application/vnd.google-earth.kml+xml" });
  });

  it("asks for nothing when it is to let the service choose", () => {
    expect(formatsToAsk(outputs, { featureCollectionOutput: null })).toEqual({});
  });

  it("falls back to the page's choice for a media type the output does not offer", () => {
    expect(formatsToAsk(outputs, { featureCollectionOutput: "image/png" })).toEqual({
      featureCollectionOutput: "application/geo+json",
    });
  });
});

describe("the request: every output listed, a format only where one is asked (the trap)", () => {
  it("lists every output of the description, with or without a format", () => {
    const formats = formatsToAsk(weaver.outputs);
    const selection = outputSelection(weaver, [], formats);
    expect(Object.keys(selection)).toEqual(weaver.outputs.map((each) => each.id));
    expect(selection["stringOutput"]).toEqual({});
    expect(selection["featureCollectionOutput"]).toEqual({
      format: { mediaType: "application/geo+json" },
    });
  });

  it("lists exactly the outputs, in the same order, as the request without a format", () => {
    const without = outputSelection(weaver);
    const withFormats = outputSelection(weaver, [], formatsToAsk(weaver.outputs));
    expect(Object.keys(withFormats)).toEqual(Object.keys(without));
  });

  it("keeps a link asked for beside the format, in 1.0", () => {
    expect(outputSelection(saga, ["RESULT"], formatsToAsk(saga.outputs))["RESULT"]).toEqual({
      format: { mediaType: "application/vnd.google-earth.kml+xml" },
      transmissionMode: "reference",
    });
  });
});

describe("the words", () => {
  const out = output(weaver, "featureCollectionOutput");
  const offered = offeredFormats(out);

  it("says what was asked and what else is offered", () => {
    expect(formatLine(out, offered, "application/geo+json")).toBe(
      "Asked for GeoJSON; the service also offers GML, KML and JSON.",
    );
  });

  it("says when nothing was asked", () => {
    expect(formatLine(out, offered, undefined)).toBe(
      "Asked for no format: the service chooses. It offers GeoJSON, GML, KML and JSON.",
    );
  });

  it("says the format is for each value of an output that may have several (maxOccurs)", () => {
    const many = withSchema(
      { oneOf: [{ contentMediaType: "application/geo+json" }, { contentMediaType: "text/xml" }] },
      true,
    );
    expect(formatLine(many, offeredFormats(many), "application/geo+json")).toBe(
      "Asked for GeoJSON, for each of its values; the service also offers XML.",
    );
  });

  it("says when the service sent another format, by its label", () => {
    expect(
      formatSentLine("application/vnd.google-earth.kml+xml", "application/json;charset=UTF-8"),
    ).toBe("Asked for KML; the service sent JSON (application/json;charset=UTF-8).");
    expect(
      formatSentLine("application/geo+json", "application/geo+json; charset=utf-8"),
    ).toBeUndefined();
    expect(formatSentLine("application/geo+json", undefined)).toBeUndefined();
  });
});
