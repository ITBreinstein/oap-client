/**
 * The process description parser, and the guarantee the form generator depends
 * on: **nothing in a `schema` is lost**.
 *
 * The schema-fidelity test here is reduction test 2 in the brief. Replace the
 * pass-through with a shallow copy that keeps only "known" keywords and it goes
 * red — which is the whole point, because a well-meaning tidy-up is exactly how
 * the bounding-box signal would disappear.
 */

import { describe, expect, it } from "vitest";
import helloWorld from "../fixtures/pygeoapi/processes/hello-world.json" with { type: "json" };
import zooEcho from "../fixtures/zoo-project/processes/echo.json" with { type: "json" };
import zooBuffer from "../fixtures/zoo-project/processes/Buffer.json" with { type: "json" };
import zooOgr2Ogr from "../fixtures/zoo-project/processes/Ogr2Ogr.json" with { type: "json" };
import zooGdalTranslate from "../fixtures/zoo-project/processes/Gdal_Translate.json" with { type: "json" };
import { MalformedProcessDocumentError } from "../../src/errors.js";
import { parseDescription } from "../../src/processes/parse-description.js";

const PYGEOAPI = "http://localhost:5080/processes/hello-world";
const ZOO = "http://localhost:5090/ogc-api/processes/echo";

describe("parseDescription against pygeoapi 0.21.0", () => {
  it("folds the inputs object into an array, keeping ids and order", () => {
    const { process } = parseDescription(helloWorld, { documentUrl: PYGEOAPI });

    expect(process.inputs.map((input) => input.id)).toEqual(["name", "message"]);
    expect(process.outputs.map((output) => output.id)).toEqual(["echo"]);
  });

  it("derives required and multiple from the declared cardinality", () => {
    const { process } = parseDescription(helloWorld, { documentUrl: PYGEOAPI });
    const [name, message] = process.inputs;

    expect(name).toMatchObject({
      id: "name",
      title: "Name",
      minOccurs: 1,
      maxOccurs: 1,
      required: true,
      multiple: false,
    });
    expect(message).toMatchObject({ id: "message", minOccurs: 0, required: false });
  });

  it("keeps the output's contentMediaType where the result renderer will look", () => {
    const { process } = parseDescription(helloWorld, { documentUrl: PYGEOAPI });

    expect(process.outputs[0]?.schema).toEqual({
      type: "object",
      contentMediaType: "application/json",
    });
  });

  it("records `example` as an unrecognised member and keeps it out of the result", () => {
    const { process, report } = parseDescription(helloWorld, { documentUrl: PYGEOAPI });

    expect([...report.unrecognisedKeys]).toEqual(["example"]);
    expect(process).not.toHaveProperty("example");
  });

  it("is assignable wherever a ProcessSummary is — the description carries both", () => {
    const { process } = parseDescription(helloWorld, { documentUrl: PYGEOAPI });

    expect(process.execution.declared).toEqual(["sync-execute", "async-execute"]);
    expect(process.version).toBe("0.2.0");
  });
});

describe("schema fidelity — the T4 guarantee", () => {
  it("hands back ZOO's bounding-box schema deep-equal to the wire, format and all", () => {
    const { process } = parseDescription(zooEcho, { documentUrl: ZOO });
    const bbox = process.inputs.find((input) => input.id === "c");

    // This is what a spatial input actually looks like on a live server:
    // inline, `format: "ogc-bbox"`, with `properties.bbox` and `properties.crs`.
    // Not a `$ref`. The form generator's headline feature reads one of these
    // keys, and the core cannot know which — so all of them survive.
    expect(bbox?.schema).toEqual(zooEcho.inputs.c.schema);
    expect(bbox?.schema["format"]).toBe("ogc-bbox");
  });

  it("preserves a schema containing oneOf, contentMediaType and contentSchema", () => {
    const { process } = parseDescription(zooBuffer, { documentUrl: ZOO });
    const polygon = process.inputs.find((input) => input.id === "InputPolygon");

    expect(polygon?.schema).toEqual(zooBuffer.inputs.InputPolygon.schema);
    // `contentSchema` is not a keyword this layer names anywhere, and it is
    // still there — which is the guarantee, stated as a test.
    expect(JSON.stringify(polygon?.schema)).toContain("contentSchema");
  });

  it("preserves a $ref and an allOf verbatim, without following either", () => {
    // ZOO puts its `$ref` inside the vendor `extended-schema`, so this case is
    // built from that real payload rather than invented: the same object, in
    // the position `schema` occupies.
    const document = {
      ...zooBuffer,
      inputs: {
        InputPolygon: {
          ...zooBuffer.inputs.InputPolygon,
          schema: zooBuffer.inputs.InputPolygon["extended-schema"],
        },
      },
    };
    const { process, census } = parseDescription(document, { documentUrl: ZOO });

    expect(process.inputs[0]?.schema).toEqual(zooBuffer.inputs.InputPolygon["extended-schema"]);
    expect(JSON.stringify(process.inputs[0]?.schema)).toContain(
      "http://zoo-project.org/dl/link.json",
    );
    expect(census.composed).toBe(1);
  });

  it("does not mutate the document it was handed", () => {
    const before = JSON.stringify(zooEcho);
    parseDescription(zooEcho, { documentUrl: ZOO });
    expect(JSON.stringify(zooEcho)).toBe(before);
  });
});

describe("ZOO's real cardinality", () => {
  it("reads Ogr2Ogr's maxOccurs 1024 as multiple", () => {
    const { process } = parseDescription(zooOgr2Ogr, { documentUrl: ZOO });
    const lco = process.inputs.find((input) => input.id === "LCO");

    expect(lco).toMatchObject({ minOccurs: 0, maxOccurs: 1024, required: false, multiple: true });
  });

  it('reads Gdal_Translate\'s live maxOccurs "unbounded" as multiple', () => {
    const { process } = parseDescription(zooGdalTranslate, { documentUrl: ZOO });
    const gcp = process.inputs.find((input) => input.id === "GCP");

    expect(gcp?.maxOccurs).toBe("unbounded");
    expect(gcp?.multiple).toBe(true);
  });

  it("marks ZOO inputs with neither field as required, per the OGC default", () => {
    const { process } = parseDescription(zooOgr2Ogr, { documentUrl: ZOO });
    const inputDsn = process.inputs.find((input) => input.id === "InputDSN");

    // The fixture declares no minOccurs and no maxOccurs for this input.
    expect(inputDsn).toMatchObject({ minOccurs: 1, maxOccurs: 1, required: true, multiple: false });
  });

  it("names ZOO's vendor input members without carrying them", () => {
    const { process, report } = parseDescription(zooBuffer, { documentUrl: ZOO });

    expect([...report.unrecognisedKeys]).toEqual(
      expect.arrayContaining(["extended-schema", "raw_schema1", "metadata", "mutable"]),
    );
    expect(process.inputs[0]).not.toHaveProperty("extended-schema");
  });
});

describe("the schema-shape census", () => {
  it("counts shapes and nothing else", () => {
    const { census } = parseDescription(zooEcho, { documentUrl: ZOO });

    // echo has four inputs: a string, a oneOf, an ogc-bbox object, a number.
    expect(census).toEqual({
      total: 4,
      inlineType: 3,
      enumerated: 0,
      ref: 0,
      composed: 1,
      contentMediaType: 0,
      formatted: 2,
      absent: 0,
    });
  });

  it("counts an input with no schema as absent rather than dropping it", () => {
    const { process, census, report } = parseDescription(
      { id: "p", version: "1", inputs: { lonely: { title: "No schema" } }, outputs: {} },
      { documentUrl: PYGEOAPI },
    );

    expect(process.inputs).toHaveLength(1);
    expect(process.inputs[0]?.schema).toEqual({});
    expect(census.absent).toBe(1);
    expect(report.warnings).toContain("inputs:lonely-schema-absent");
  });
});

describe("parseDescription tolerance", () => {
  it("throws only for the fatal shapes, naming where", () => {
    expect(() => parseDescription([], { documentUrl: PYGEOAPI })).toThrow(
      MalformedProcessDocumentError,
    );
    expect(() => parseDescription([], { documentUrl: PYGEOAPI })).toThrow(
      /process description.*expected a JSON object, got an array/s,
    );
    expect(() => parseDescription({ title: "x" }, { documentUrl: PYGEOAPI })).toThrow(
      /no `id` member/,
    );
  });

  it("degrades absent inputs and outputs into empty arrays plus warnings", () => {
    const { process, report } = parseDescription(
      { id: "p", version: "1" },
      { documentUrl: PYGEOAPI },
    );

    expect(process.inputs).toEqual([]);
    expect(process.outputs).toEqual([]);
    expect(report.warnings).toEqual(expect.arrayContaining(["inputs-absent", "outputs-absent"]));
  });

  it("skips one unusable input without losing its siblings", () => {
    const { process, report } = parseDescription(
      {
        id: "p",
        version: "1",
        inputs: { good: { schema: { type: "string" } }, bad: "not an object" },
        outputs: {},
      },
      { documentUrl: PYGEOAPI },
    );

    expect(process.inputs.map((input) => input.id)).toEqual(["good"]);
    expect(report.warnings).toContain("inputs:bad:not-an-object");
  });

  it("records a description whose id is not the one that was asked for", () => {
    const { report } = parseDescription(helloWorld, {
      documentUrl: PYGEOAPI,
      requestedId: "something-else",
    });

    expect(report.warnings).toContain("id-does-not-match-the-requested-process");
  });

  it("keeps an input id that looks like an integer in document order", () => {
    // The reason inputs are an array: object key order puts integer-like keys
    // first, so `{ "1": …, "alpha": … }` would render "1" above "alpha" in a
    // form even though the server listed it second.
    const { process } = parseDescription(
      { id: "p", version: "1", inputs: { alpha: {}, "1": {} }, outputs: {} },
      { documentUrl: PYGEOAPI },
    );

    // Object.entries still reports the integer-like key first — the array is
    // what makes that order *stable and visible*, rather than a surprise.
    expect(process.inputs.map((input) => input.id)).toEqual(["1", "alpha"]);
  });
});
