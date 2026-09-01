/**
 * The Task 3 types are importable from `apps/web` under its own tsconfig.
 *
 * Cheap, and it is the acceptance criterion the form generator depends on:
 * three weeks of React, MapLibre and Terra Draw work start against these types
 * before the parsing behind them is finished, so a break in the published
 * surface has to be a compile error here rather than a surprise in September.
 */

import { expect, it } from "vitest";
import { normaliseCardinality, processUrlFor } from "@breinstein/oap-client";
import type {
  InputDescription,
  JsonSchema,
  OutputDescription,
  ProcessDescription,
  ProcessExecutionOptions,
  ProcessList,
  ProcessSummary,
  SchemaShapeCensus,
} from "@breinstein/oap-client";

it("exposes the process types and the value exports the form generator needs", () => {
  // A bounding-box input, in the shape ZOO really sends one.
  const schema: JsonSchema = {
    type: "object",
    format: "ogc-bbox",
    required: ["bbox", "crs"],
    properties: { bbox: { type: "array" }, crs: { type: "string" } },
  };

  const input: InputDescription = {
    id: "c",
    title: "BoundingBox Input",
    minOccurs: 0,
    maxOccurs: 1,
    required: false,
    multiple: false,
    schema,
  };
  const output: OutputDescription = { id: "c", schema };
  const execution: ProcessExecutionOptions = {
    sync: true,
    async: true,
    dismiss: true,
    declared: ["sync-execute", "async-execute", "dismiss"],
    defaulted: false,
  };
  const description: ProcessDescription = {
    id: "echo",
    execution,
    outputTransmission: ["value"],
    links: [],
    inputs: [input],
    outputs: [output],
  };

  // `ProcessDescription extends ProcessSummary`, so it goes wherever one does.
  const summary: ProcessSummary = description;
  const list: ProcessList = { processes: [summary], links: [], pageCount: 1, truncated: false };
  const census: SchemaShapeCensus = {
    total: 1,
    inlineType: 1,
    enumerated: 0,
    ref: 0,
    composed: 0,
    contentMediaType: 0,
    formatted: 1,
    absent: 0,
  };

  expect(list.processes[0]?.id).toBe("echo");
  expect(census.formatted).toBe(1);
  // The schema is open, so reading an unmodelled keyword is legal and typed
  // `unknown` — the form generator narrows at the point of use.
  expect(description.inputs[0]?.schema["format"]).toBe("ogc-bbox");
  expect(normaliseCardinality(undefined, undefined).cardinality.required).toBe(true);
  expect(processUrlFor("https://x.test/processes", "a b")).toBe("https://x.test/processes/a%20b");
});
