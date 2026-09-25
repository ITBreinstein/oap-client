/**
 * The resolver and encoder against requests servers accepted. Sam's idea and
 * captures (see `../fixtures/forms/README.md`); the harness is his, pointed at
 * this app's form plan and value shapes.
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
  | "directed-undocumented-array"
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
      // The captures write `{{baseUrl}}`, which is not a URL. Links resolve
      // against this, and nothing here fetches, so any absolute base will do.
      documentUrl: (finalUrl ?? "").replace("{{baseUrl}}", "http://localhost/ogc-api"),
    }).process,
  );
}

function capturedInputs(name: Name): Record<string, unknown> {
  const { body } = envelope(name, "execute.request.json");
  return (body as { inputs: Record<string, unknown> }).inputs;
}

/**
 * ZOO's nested `format` rewritten as the standard's flat form, so a capture
 * can be compared with what we send. Narrow on purpose: it hoists the members
 * of a `format` object and touches nothing else — a normaliser that reshaped
 * more would make every assertion pass for free, which is why it has its own
 * test below.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (
      key === "format" &&
      typeof member === "object" &&
      member !== null &&
      !Array.isArray(member)
    ) {
      Object.assign(result, member);
      continue;
    }
    result[key] = canonical(member);
  }
  return result;
}

/** What the encoder sends for these values, and the capture for the same ids. */
function compare(name: Name, values: FormValues) {
  const sent = toExecuteBody(planOf(name), values).inputs;
  const captured = capturedInputs(name);
  const expected = Object.fromEntries(
    Object.keys(values).map((id) => [id, canonical(captured[id])]),
  );
  return { sent: JSON.parse(JSON.stringify(sent)) as unknown, expected };
}

function text(name: Name, id: string, key: "value" | "href"): string {
  const input = capturedInputs(name)[id] as Record<string, unknown>;
  const found = input[key];
  if (typeof found !== "string") throw new Error(`${name} ${id} has no ${key}`);
  return found;
}

describe("the normaliser the comparisons rely on", () => {
  it("hoists a nested format and leaves everything else alone", () => {
    expect(
      canonical({ value: "id\n", format: { mediaType: "text/csv", encoding: "utf-8" } }),
    ).toEqual({ value: "id\n", mediaType: "text/csv", encoding: "utf-8" });
  });

  it("does not unwrap a value, rename a key, or drop anything", () => {
    const untouched = { href: "https://example.test/a.gml", type: "text/xml" };
    expect(canonical(untouched)).toEqual(untouched);
    expect(canonical({ value: { type: "Feature", properties: { value: 2 } } })).toEqual({
      value: { type: "Feature", properties: { value: 2 } },
    });
    expect(canonical([{ a: 1 }, 2, "3", null])).toEqual([{ a: 1 }, 2, "3", null]);
  });
});

describe("requests servers accepted", () => {
  it("sends CSV inline with the chosen format's media type and encoding, and real booleans", () => {
    const name = "zoo-inline-csv";
    const { sent, expected } = compare(name, {
      TABLE_A: { format: 0, value: text(name, "TABLE_A", "value") },
      TABLE_B: { format: 0, value: text(name, "TABLE_B", "value") },
      FIELDS_ALL: true,
      KEEP_ALL: true,
      CMP_CASE: true,
    });
    expect(sent).toEqual(expected);
  });

  it("sends base64 where it is the only encoding, and enum strings as they are", () => {
    const name = "zoo-inline-las";
    const { sent, expected } = compare(name, {
      POINTS: { format: 0, value: text(name, "POINTS", "value") },
      OUTPUT: "only z",
      AGGREGATION: "mean value",
      CELLSIZE: "0.005",
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

  it("sends a list entered item by item as the plain array the server took", () => {
    const { sent, expected } = compare("directed-undocumented-array", {
      intensity: [{ rawJson: "0" }, { rawJson: "30" }],
    });
    expect(sent).toEqual(expected);
  });

  it("sends a GeoJSON object as a qualified value, without inventing a media type", () => {
    // The capture also names `application/json`, which the description does
    // not declare for this branch; the pinned ZOO answers the same without it.
    const name = "zoo-inline-geojson-polygons";
    const polygons = capturedInputs(name)["POLYGONS"] as { value: unknown };
    const { sent, expected } = compare(name, {
      POLYGONS: { format: 2, value: JSON.stringify(polygons.value) },
      STAT_SUM: false,
      STAT_AVG: true,
      BND_KEEP: false,
      MIN_AREA: "0",
    });
    expect(sent).toEqual({
      ...(expected as Record<string, unknown>),
      POLYGONS: { value: polygons.value },
    });
    expect((expected as Record<string, unknown>)["POLYGONS"]).toEqual({
      value: polygons.value,
      mediaType: "application/json",
    });
  });
});
