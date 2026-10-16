/**
 * The record of what was sent, in words (`app/sent-inputs.ts`): one case per
 * control kind, and the lines around them.
 */

import type { ProcessDescription } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import type { Control, FieldPlan, FormPlan } from "../../src/forms/plan.js";
import {
  describeGeoJson,
  notSentLine,
  outputsLine,
  sizeInWords,
  summarise,
  summaryText,
  wasSent,
  type Summary,
} from "../../src/app/sent-inputs.js";

function field(control: Control, extra: Partial<FieldPlan> = {}): FieldPlan {
  return { id: "x", title: "X", required: true, control, ...extra };
}

const text = (summary: Summary) => summaryText(summary);
const monoParts = (summary: Summary) =>
  summary.parts.filter((part) => part.mono === true).map((part) => part.text);

const SQUARE = {
  type: "Polygon",
  coordinates: [
    [
      [4.88, 52.37],
      [4.89, 52.37],
      [4.89, 52.38],
      [4.885, 52.385],
      [4.88, 52.38],
      [4.88, 52.37],
    ],
  ],
};

function collection(count: number, geometry: unknown = SQUARE) {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: count }, () => ({ type: "Feature", properties: {}, geometry })),
  };
}

describe("summarise, by control kind", () => {
  it("text: the value, in the UI face", () => {
    const summary = summarise(field({ kind: "text" }), "Groningen");
    expect(text(summary)).toBe("Groningen");
    expect(monoParts(summary)).toEqual([]);
    expect(summary.full).toBeUndefined();
  });

  it("text with an identifier's format: in mono", () => {
    const summary = summarise(field({ kind: "text", format: "uri" }), "https://example.org/a");
    expect(monoParts(summary)).toEqual(["https://example.org/a"]);
  });

  it("text longer than a line: a lead, and the whole value to fold out", () => {
    const long = "one\ntwo\nthree";
    const summary = summarise(field({ kind: "text", multiline: true }), long);
    expect(text(summary)).toBe("3 lines, starting “one”");
    expect(summary.full).toBe(long);
  });

  it("number: the digits as typed, in mono", () => {
    const summary = summarise(field({ kind: "number", integer: false }), " 12.50 ");
    expect(text(summary)).toBe("12.50");
    expect(monoParts(summary)).toEqual(["12.50"]);
  });

  it("select: the chosen option's label, not its value", () => {
    const control: Control = {
      kind: "select",
      options: [
        { value: "a", label: "Alpha" },
        { value: { deep: true }, label: "Deep" },
      ],
    };
    expect(text(summarise(field(control), "a"))).toBe("Alpha");
    expect(text(summarise(field(control), { deep: true }))).toBe("Deep");
  });

  it("checkbox: Yes or No", () => {
    expect(text(summarise(field({ kind: "checkbox" }), true))).toBe("Yes");
    expect(text(summarise(field({ kind: "checkbox" }), false))).toBe("No");
  });

  it("list: the items by commas, then how many more after five", () => {
    const control: Control = { kind: "list", item: { kind: "number", integer: true } };
    expect(text(summarise(field(control), ["1", "2", ""]))).toBe("1, 2");
    expect(text(summarise(field(control), ["1", "2", "3", "4", "5", "6", "7"]))).toBe(
      "1, 2, 3, 4, 5 + 2 more",
    );
  });

  it("bbox: the corners in mono; the CRS only when it is not WGS 84", () => {
    const control: Control = {
      kind: "bbox",
      crs: [],
      defaultCrs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      dimensions: [4],
    };
    const wgs84 = summarise(field(control), {
      coordinates: [4.88, 52.36, 4.9, 52.38],
      crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    });
    expect(text(wgs84)).toBe("4.88, 52.36 – 4.9, 52.38");
    expect(monoParts(wgs84)).toEqual(["4.88, 52.36 – 4.9, 52.38"]);
    const rd = summarise(field(control), {
      coordinates: [120000, 480000, 121000, 481000],
      crs: "http://www.opengis.net/def/crs/EPSG/0/28992",
    });
    expect(text(rd)).toBe(
      "120000, 480000 – 121000, 481000, in http://www.opengis.net/def/crs/EPSG/0/28992",
    );
  });

  it("geometry: its type and size in words, the map's outline when it is drawn, the GeoJSON to fold out", () => {
    const geojson = JSON.stringify(SQUARE);
    const control: Control = { kind: "geometry", wrapper: "geometry", geometryTypes: ["Polygon"] };
    const summary = summarise(field(control), { geojson }, { onMap: true });
    expect(text(summary)).toBe("Polygon, 5 points. Shown on the map as the dashed outline.");
    expect(summary.full).toBe(geojson);
    expect(text(summarise(field(control), { geojson }))).toBe("Polygon, 5 points.");
  });

  it("complex, inline: how and in what format, and its size", () => {
    const control: Control = {
      kind: "complex",
      formats: [
        { label: "JSON object", object: true },
        { label: "application/gml+xml", mediaType: "application/gml+xml", object: false },
      ],
      byReference: true,
    };
    const value = JSON.stringify(collection(6));
    const object = summarise(field(control), { format: 0, value }, { onMap: true });
    expect(text(object)).toBe(
      `Inline, as a JSON object (${sizeInWords(value.length)}): FeatureCollection, 6 features (polygons). Shown on the map as the dashed outline.`,
    );
    expect(object.full).toBe(value);
    expect(text(summarise(field(control), { format: 1, value: "<gml:Polygon/>" }))).toBe(
      "Inline, as application/gml+xml (14 bytes).",
    );
  });

  it("complex, by link: the URL in mono, and that the service fetched it", () => {
    const control: Control = {
      kind: "complex",
      formats: [{ label: "JSON object", object: true }],
      byReference: true,
    };
    const value = { format: 0, href: "https://example.org/areas.geojson" };
    const done = summarise(field(control), value, { done: true });
    expect(text(done)).toBe("By link: https://example.org/areas.geojson (the service fetched it)");
    expect(monoParts(done)).toEqual(["https://example.org/areas.geojson"]);
    expect(text(summarise(field(control), value))).toContain("(the service fetches it)");
  });

  it("complex, from a file: the file's name and size; base64 counted as the bytes it stands for", () => {
    const control: Control = {
      kind: "complex",
      formats: [
        { label: "image/png (base64)", mediaType: "image/png", encoding: "base64", object: false },
      ],
      byReference: false,
    };
    // 12 bytes of base64 stand for 9 bytes.
    const summary = summarise(field(control), {
      format: 0,
      value: "AAAAAAAAAAAA",
      file: "dot.png",
    });
    expect(text(summary)).toBe("From a file: dot.png (9 bytes).");
    expect(monoParts(summary)).toEqual(["dot.png"]);
    expect(summary.full).toBeUndefined();
  });

  it("json: its size, and the text to fold out", () => {
    const raw = '{ "a": 1 }';
    const summary = summarise(field({ kind: "json", reason: "a oneOf" }), { rawJson: raw });
    expect(text(summary)).toBe("JSON, 10 bytes");
    expect(summary.full).toBe(raw);
  });
});

describe("GeoJSON in words", () => {
  it("names each kind with its size", () => {
    expect(describeGeoJson(JSON.stringify({ type: "Point", coordinates: [4, 52] }))).toBe("Point");
    expect(
      describeGeoJson(
        JSON.stringify({
          type: "LineString",
          coordinates: [
            [4, 52],
            [5, 53],
          ],
        }),
      ),
    ).toBe("LineString, 2 points");
    expect(
      describeGeoJson(JSON.stringify({ type: "Feature", properties: {}, geometry: SQUARE })),
    ).toBe("Feature: Polygon, 5 points");
    expect(describeGeoJson(JSON.stringify(collection(1)))).toBe(
      "FeatureCollection, 1 feature (polygons)",
    );
  });

  it("says what a mixed collection holds", () => {
    const mixed = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: SQUARE },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [4, 52] } },
        { type: "Feature", properties: {}, geometry: null },
      ],
    };
    expect(describeGeoJson(JSON.stringify(mixed))).toBe(
      "FeatureCollection, 3 features (polygons, points and no geometry)",
    );
  });

  it("is undefined for what is not GeoJSON", () => {
    expect(describeGeoJson("not json")).toBeUndefined();
    expect(describeGeoJson('{"a":1}')).toBeUndefined();
  });
});

describe("sizes", () => {
  it("in bytes, kB and MB", () => {
    expect(sizeInWords(1)).toBe("1 byte");
    expect(sizeInWords(640)).toBe("640 bytes");
    expect(sizeInWords(2355)).toBe("2.3 kB");
    expect(sizeInWords(12 * 1024)).toBe("12 kB");
    expect(sizeInWords(1.4 * 1024 * 1024)).toBe("1.4 MB");
  });
});

describe("what was left out", () => {
  const plan: FormPlan = {
    fields: [
      { id: "name", title: "Name", required: true, control: { kind: "text" } },
      { id: "message", title: "Message", required: false, control: { kind: "text" } },
      {
        id: "seconds",
        title: "Seconds",
        required: false,
        control: { kind: "number", integer: false },
      },
    ],
    diagnostics: [],
  };

  it("lists every input that was not sent in one line", () => {
    expect(notSentLine(plan, { name: "Groningen", message: "", seconds: "  " })).toBe(
      "Not sent: Message (optional, left empty), Seconds (optional, left empty).",
    );
  });

  it("says nothing when everything was sent", () => {
    expect(notSentLine(plan, { name: "a", message: "b", seconds: "1" })).toBeUndefined();
  });

  it("counts a number of spaces as not sent, as the encoder does", () => {
    const seconds = plan.fields[2];
    if (seconds === undefined) throw new Error("no field");
    expect(wasSent(seconds, "  ")).toBe(false);
    expect(wasSent(seconds, "0")).toBe(true);
  });
});

describe("the outputs", () => {
  function processWith(outputTransmission: string[]): ProcessDescription {
    return {
      id: "p",
      version: "1",
      outputTransmission,
      outputs: [
        { id: "buildings", schema: { type: "object", contentMediaType: "application/geo+json" } },
        { id: "table", title: "Table", schema: { type: "string", contentMediaType: "text/csv" } },
      ],
    } as unknown as ProcessDescription;
  }

  it("says how each was asked for, where the form offered the choice", () => {
    expect(outputsLine(processWith(["value", "reference"]), ["table"], false)).toBe(
      "buildings as GeoJSON, by value; Table as CSV, by link.",
    );
  });

  it("says nothing where there was no choice", () => {
    expect(outputsLine(processWith(["value"]), [], false)).toBeUndefined();
  });

  it("in the developer view, a link asked for anyway is marked as beyond the description", () => {
    expect(outputsLine(processWith(["value"]), ["buildings"], true)).toBe(
      "buildings as GeoJSON, by link, asked beyond the description; Table as CSV, by value.",
    );
  });
});
