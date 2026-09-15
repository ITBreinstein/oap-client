import { describe, expect, it } from "vitest";
import { encodeInputs } from "../../src/execution/encode-inputs.js";
import {
  type CapturedFormName,
  canonical,
  capturedDescription,
  capturedInputs,
  expectedInputs,
} from "./captured-forms.js";

/**
 * The encoder against requests that servers actually accepted.
 *
 * Each case states, by hand, what a user would have entered into the form. The
 * bag is written out rather than derived from the capture on purpose: an
 * inverted capture would make every assertion pass whatever the encoder did.
 */

/** Encodes a bag against a captured description and compares with that capture. */
function check(name: CapturedFormName, values: Record<string, unknown>): void {
  const description = capturedDescription(name);
  const { inputs } = encodeInputs(description.inputs, values);
  expect(inputs).toEqual(expectedInputs(name, Object.keys(values)));
}

describe("the normaliser the comparisons rely on", () => {
  it("hoists a nested format and leaves everything else alone", () => {
    expect(
      canonical({
        value: "id,name\n",
        format: { mediaType: "text/csv", encoding: "utf-8" },
      }),
    ).toEqual({ value: "id,name\n", mediaType: "text/csv", encoding: "utf-8" });
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

describe("booleans and enums, which ZOO conflates", () => {
  // ZOO declares `{"type":"boolean","default":true,"enum":["true","false"]}`, so
  // the form renders a dropdown that writes the *string* "true". Every ZOO
  // process has several of these; getting it wrong ships them all as strings.
  it("sends a real boolean whether the form held one or the dropdown's string", () => {
    check("zoo-inline-csv", { FIELDS_ALL: true, KEEP_ALL: "true", CMP_CASE: true });
  });

  it("keeps false, which is a value and not an absence", () => {
    check("zoo-inline-geojson-polygons", { STAT_SUM: false, STAT_AVG: true, BND_KEEP: false });
  });

  it("keeps zero for the same reason", () => {
    check("zoo-inline-geojson-polygons", { MIN_AREA: 0 });
  });

  it("leaves a plain string enum as the string it is", () => {
    check("zoo-inline-las", { OUTPUT: "only z", AGGREGATION: "mean value" });
  });
});

describe("scalars", () => {
  it("sends numbers and integers bare", () => {
    check("bgt-numeric-ranges", {
      latitude: 52.6324,
      longitude: 4.7534,
      inner_radius_m: 300,
      outer_radius_m: 500,
    });
  });

  it("recovers a number the form left as text", () => {
    check("bgt-numeric-ranges", { latitude: "52.6324" });
    check("zoo-inline-las", { CELLSIZE: "0.005" });
  });
});

describe("complex values", () => {
  it("derives the media type and encoding when the schema declares one of each", () => {
    // Both branches say text/csv; the encodings offered are utf-8 and base64,
    // and plain text wins where it is on offer.
    check("zoo-inline-csv", {
      TABLE_A: "id,name,elevation_m\n1,Waagplein,2.1\n2,Victoriepark,3.4\n3,Alkmaarderhout,1.8\n",
    });
  });

  it("uses base64 when the schema offers nothing else", () => {
    const points = capturedInputs("zoo-inline-las")["POINTS"] as { value: string };
    check("zoo-inline-las", { POINTS: points.value });
  });

  it("qualifies an inline object, naming JSON where the description does not", () => {
    // The chosen branch is a bare `{"type":"object"}`; the only media types the
    // input declares are XML and KML. The server took application/json anyway.
    const polygons = capturedInputs("zoo-inline-geojson-polygons")["POLYGONS"] as {
      value: unknown;
    };
    check("zoo-inline-geojson-polygons", { POLYGONS: polygons.value });
  });

  it("turns a pasted URL into a reference, with the declared type", () => {
    const entities = capturedInputs("zoo-linked-gml");
    check("zoo-linked-gml", {
      InputEntity1: (entities["InputEntity1"] as { href: string }).href,
      InputEntity2: (entities["InputEntity2"] as { href: string }).href,
    });
  });
});

describe("arrays", () => {
  it("sends a semantic array bare, items and all", () => {
    // `{"type":"array"}` with no `items` and maxOccurs 1 — one answer that
    // happens to be a list, not two occurrences.
    check("directed-undocumented-array", { intensity: [0, 30] });
  });

  it("never invents an array and never unwraps one", () => {
    const description = capturedDescription("zoo-inline-csv");
    const single = encodeInputs(description.inputs, { FIELDS_ALL: true }).inputs;
    const listed = encodeInputs(description.inputs, { FIELDS_ALL: [true, false] }).inputs;

    expect(single["FIELDS_ALL"]).toBe(true);
    expect(listed["FIELDS_ALL"]).toEqual([true, false]);
  });
});

describe("what the form did not fill in", () => {
  it("omits absent values and says which", () => {
    const description = capturedDescription("bgt-numeric-ranges");
    const { inputs, omitted } = encodeInputs(description.inputs, {
      latitude: 52.6,
      longitude: undefined,
      inner_radius_m: "",
      outer_radius_m: null,
    });

    expect(inputs).toEqual({ latitude: 52.6 });
    expect(omitted).toEqual(["longitude", "inner_radius_m", "outer_radius_m"]);
  });

  it("sends an undeclared value rather than dropping it, and notes it", () => {
    const description = capturedDescription("bgt-numeric-ranges");
    const { inputs, notes } = encodeInputs(description.inputs, { nosuch: "x" });

    expect(inputs["nosuch"]).toBe("x");
    expect(notes.join(" ")).toContain("not declared");
  });
});

describe("encoding an encoded value changes nothing", () => {
  // The raw JSON editor is the only way to author a wrapper by hand today, so
  // passthrough has to be a fixed point or a second render would double-wrap.
  it.each([
    ["zoo-inline-csv", "TABLE_A"],
    ["zoo-inline-las", "POINTS"],
    ["zoo-linked-gml", "InputEntity1"],
    ["zoo-inline-geojson-polygons", "POLYGONS"],
  ] as const)("holds for %s %s", (name, id) => {
    const description = capturedDescription(name);
    const authored = canonical(capturedInputs(name)[id]);

    const once = encodeInputs(description.inputs, { [id]: authored }).inputs;
    const twice = encodeInputs(description.inputs, { [id]: once[id] }).inputs;

    expect(twice).toEqual(once);
  });
});
