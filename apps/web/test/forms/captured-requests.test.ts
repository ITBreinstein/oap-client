/**
 * The resolver and encoder against requests a real server was sent. The idea
 * and the harness are Sam's; the captures are our own, from the pinned
 * ZOO-Project (see `../fixtures/forms/README.md`), pointed at this app's form
 * plan and value shapes.
 *
 * Each case states by hand what a user would have entered in the form. The
 * values are written out rather than derived from the capture on purpose: an
 * inverted capture would make every assertion pass whatever the encoder did.
 */

import { parseDescription } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { toExecuteBody, type FormValues } from "../../src/forms/encode.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";

const captures = import.meta.glob<string>("../fixtures/forms/*/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

type Name =
  | "hand-written-undocumented-array"
  | "zoo-inline-csv"
  | "zoo-inline-geojson-polygons"
  | "zoo-inline-las"
  | "zoo-linked-gml";

function envelope(name: Name, file: string): { final_url?: string; body: unknown } {
  const raw = captures[`../fixtures/forms/${name}/${file}`];
  if (raw === undefined) throw new Error(`no capture ${name}/${file}`);
  return JSON.parse(raw) as { final_url?: string; body: unknown };
}

function planOf(name: Name) {
  const { final_url: finalUrl, body } = envelope(name, "description.json");
  return resolveFormPlan(
    parseDescription(body, {
      // A hand-written description was served from nowhere. Links resolve
      // against this, and nothing here fetches, so any absolute base will do.
      documentUrl: finalUrl ?? "http://localhost/ogc-api/processes/hand-written",
    }).process,
  );
}

function capturedInputs(name: Name): Record<string, unknown> {
  const { body } = envelope(name, "execute.request.json");
  return (body as { inputs: Record<string, unknown> }).inputs;
}

/** What the encoder sends for these values, and the capture for the same ids. */
function compare(name: Name, values: FormValues) {
  const sent = toExecuteBody(planOf(name), values).inputs;
  const captured = capturedInputs(name);
  const expected = Object.fromEntries(Object.keys(values).map((id) => [id, captured[id]]));
  return { sent: JSON.parse(JSON.stringify(sent)) as unknown, expected };
}

function text(name: Name, id: string, key: "value" | "href"): string {
  const input = capturedInputs(name)[id] as Record<string, unknown>;
  const found = input[key];
  if (typeof found !== "string") throw new Error(`${name} ${id} has no ${key}`);
  return found;
}

describe("requests sent to the pinned ZOO-Project", () => {
  it("sends CSV inline with the chosen format's media type and encoding, and real booleans", () => {
    const name = "zoo-inline-csv";
    const { sent, expected } = compare(name, {
      TABLE_A: { format: 0, value: text(name, "TABLE_A", "value") },
      TABLE_B: { format: 0, value: text(name, "TABLE_B", "value") },
      FIELDS_ALL: true,
      KEEP_ALL: true,
      CMP_CASE: false,
    });
    expect(sent).toEqual(expected);
  });

  it("sends base64 where it is the only encoding, and enum strings as they are", () => {
    // ZOO's kernel crashes on this request, and on any LAS input: its SAGA
    // build has no LAS reader (finding 0070). The request is still the one the
    // description asks for.
    const name = "zoo-inline-las";
    const { sent, expected } = compare(name, {
      POINTS: { format: 0, value: text(name, "POINTS", "value") },
      OUTPUT: "only z",
      AGGREGATION: "highest z",
      CELLSIZE: "0.5",
    });
    expect(sent).toEqual(expected);
  });

  it("sends a URL as a reference with the chosen format's media type", () => {
    const name = "zoo-linked-gml";
    const { sent, expected } = compare(name, {
      InputEntity1: { format: 0, href: text(name, "InputEntity1", "href") },
      InputEntity2: { format: 0, href: text(name, "InputEntity2", "href") },
    });
    expect(sent).toEqual(expected);
  });

  it("sends a GeoJSON object as a qualified value, without inventing a media type", () => {
    // The `type: object` branch declares no media type, so none is sent. ZOO
    // answers 200 with no output to this, and to the same polygons as GML
    // (finding 0071).
    const name = "zoo-inline-geojson-polygons";
    const polygons = capturedInputs(name)["POLYGONS"] as { value: unknown };
    const { sent, expected } = compare(name, {
      POLYGONS: { format: 2, value: JSON.stringify(polygons.value) },
      STAT_SUM: true,
      STAT_AVG: false,
      BND_KEEP: false,
      MIN_AREA: "0",
    });
    expect(sent).toEqual(expected);
    expect(polygons).toEqual({ value: polygons.value });
  });
});

describe("a hand-written description", () => {
  // Neither reference server declares an array input without `items`, so this
  // one is written by hand rather than captured.
  it("sends a list entered item by item as a plain array", () => {
    const { sent, expected } = compare("hand-written-undocumented-array", {
      values: [{ rawJson: "4" }, { rawJson: "25" }],
    });
    expect(sent).toEqual(expected);
    expect(expected).toEqual({ values: [4, 25] });
  });
});
