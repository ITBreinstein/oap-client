/**
 * The cardinality table. Small module, disproportionate blast radius: get the
 * defaults backwards and every generated form marks every field optional, the
 * user submits an empty one, and the server's rejection is unexplainable during
 * a demo.
 *
 * The `minOccurs: 1` default is reduction test 1 in the brief — flip it to 0 and
 * the first three cases here go red.
 */

import { describe, expect, it } from "vitest";
import { normaliseCardinality } from "../../src/processes/cardinality.js";

describe("normaliseCardinality", () => {
  it("treats an input with neither field as required and single — the OGC default", () => {
    const { cardinality, warnings } = normaliseCardinality(undefined, undefined);

    expect(cardinality).toEqual({
      minOccurs: 1,
      maxOccurs: 1,
      required: true,
      multiple: false,
    });
    // Absent is the common case and the spec defines it; only a *present and
    // unusable* value is worth reporting.
    expect(warnings).toEqual([]);
  });

  it("makes minOccurs 0 optional", () => {
    expect(normaliseCardinality(0, undefined).cardinality).toMatchObject({
      minOccurs: 0,
      required: false,
    });
  });

  it("keeps an explicit minOccurs 1 required", () => {
    expect(normaliseCardinality(1, 1).cardinality).toMatchObject({ required: true });
  });

  it("makes a numeric maxOccurs above 1 multiple", () => {
    expect(normaliseCardinality(0, 3).cardinality).toMatchObject({
      maxOccurs: 3,
      multiple: true,
    });
  });

  it('makes maxOccurs "unbounded" multiple, keeping the literal', () => {
    const { cardinality } = normaliseCardinality(0, "unbounded");

    expect(cardinality.maxOccurs).toBe("unbounded");
    expect(cardinality.multiple).toBe(true);
  });

  it("does not read a string maxOccurs as a number", () => {
    // `"3" > 1` is true in JavaScript through coercion, which is exactly the
    // bug this guards: a string that is not the "unbounded" literal is not a
    // count, and falls back to the default rather than being coerced.
    const { cardinality, warnings } = normaliseCardinality(undefined, "3");

    expect(cardinality.maxOccurs).toBe(1);
    expect(cardinality.multiple).toBe(false);
    expect(warnings).toContain("max-occurs-not-an-integer");
  });

  it('falls back to 1 and warns for a string minOccurs — some servers emit "1"', () => {
    const { cardinality, warnings } = normaliseCardinality("1", undefined);

    expect(cardinality.minOccurs).toBe(1);
    expect(cardinality.required).toBe(true);
    expect(warnings).toEqual(["min-occurs-not-an-integer"]);
  });

  it("rejects non-integers and out-of-range counts rather than throwing", () => {
    expect(normaliseCardinality(1.5, undefined).cardinality.minOccurs).toBe(1);
    expect(normaliseCardinality(-1, undefined).cardinality.minOccurs).toBe(1);
    expect(normaliseCardinality(null, undefined).cardinality.minOccurs).toBe(1);
    // maxOccurs below 1 is meaningless; the floor differs from minOccurs's.
    expect(normaliseCardinality(undefined, 0).cardinality.maxOccurs).toBe(1);
  });

  it("carries ZOO's real values: maxOccurs 1024 and a live 'unbounded'", () => {
    // Ogr2Ogr's LCO/DSCO, and Gdal_Translate's GCP. Both captured 2026-08-31.
    expect(normaliseCardinality(0, 1024).cardinality).toMatchObject({
      maxOccurs: 1024,
      multiple: true,
      required: false,
    });
    expect(normaliseCardinality(0, "unbounded").cardinality).toMatchObject({
      multiple: true,
      required: false,
    });
  });
});
