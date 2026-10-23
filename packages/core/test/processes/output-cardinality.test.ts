/**
 * An output's `minOccurs`/`maxOccurs`: new in the 2.0 draft, read by the
 * inputs' rules (Task 3), and 1 when absent. No requirement states an
 * output's default; it is the `default: 1` of `schemaAndOccurrences.yaml`,
 * which inputs and outputs share, at the draft's commit 756b659.
 */

import { describe, expect, it } from "vitest";
import { parseDescription } from "../../src/processes/parse-description.js";
import weaverEcho from "../fixtures/weaver/processes/EchoProcess.json" with { type: "json" };
import helloWorld from "../fixtures/pygeoapi/processes/hello-world.json" with { type: "json" };

const URL_OF = "https://service.test/processes/p";

function withOutput(member: Record<string, unknown>) {
  return parseDescription(
    {
      id: "p",
      version: "1",
      inputs: {},
      outputs: { out: { schema: { type: "string" }, ...member } },
    },
    { documentUrl: URL_OF },
  );
}

describe("output cardinality", () => {
  it("is 1 and 1 when the output says nothing, as every 1.0 output does", () => {
    const [output] = parseDescription(helloWorld, { documentUrl: URL_OF }).process.outputs;
    expect(output).toMatchObject({ minOccurs: 1, maxOccurs: 1, multiple: false });
  });

  it("is 1 and 1 on Weaver's outputs too, which declare none", () => {
    const { outputs } = parseDescription(weaverEcho, { documentUrl: URL_OF }).process;
    expect(outputs.length).toBe(10);
    for (const output of outputs) expect(output.maxOccurs).toBe(1);
  });

  it("reads a number and `unbounded`", () => {
    expect(withOutput({ maxOccurs: 3 }).process.outputs[0]).toMatchObject({
      maxOccurs: 3,
      multiple: true,
    });
    expect(withOutput({ minOccurs: 0, maxOccurs: "unbounded" }).process.outputs[0]).toMatchObject({
      minOccurs: 0,
      maxOccurs: "unbounded",
      multiple: true,
    });
  });

  it("warns about an unusable value and falls back to the default", () => {
    const { process, report } = withOutput({ maxOccurs: "3" });
    expect(process.outputs[0]?.maxOccurs).toBe(1);
    expect(report.warnings).toContain("outputs:out:max-occurs-not-an-integer");
  });

  it("no longer reports `minOccurs`/`maxOccurs` on an output as unrecognised", () => {
    const { report } = withOutput({ minOccurs: 1, maxOccurs: 2 });
    expect(report.unrecognisedKeys.has("minOccurs")).toBe(false);
    expect(report.unrecognisedKeys.has("maxOccurs")).toBe(false);
  });
});
