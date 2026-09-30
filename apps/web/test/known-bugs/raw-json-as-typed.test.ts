/**
 * Review (2026-09-30): "it will be sent as typed" (encode.ts:90, FormFields
 * JsonInput). The raw JSON editor's text is parsed with JSON.parse
 * (encode.ts:176-183) and the core serialises the parsed value again, so
 * numbers JavaScript cannot hold exactly change on the way out, and nothing
 * says so. The check below serialises the body the way `fetch` would.
 */

import { describe, expect, it } from "vitest";
import { toExecuteBody } from "../../src/forms/encode.js";
import { planFor } from "../forms/helpers.js";

describe("the raw JSON editor", () => {
  const plan = planFor({ filter: { schema: { type: "object", not: { required: ["x"] } } } });

  it("is the JSON control for this input", () => {
    expect(plan.fields[0]?.control.kind).toBe("json");
  });

  it.fails("W28: sends a 19-digit identifier as typed", () => {
    const typed = '{"value":{"objectId":1234567890123456789}}';
    const wire = JSON.stringify(toExecuteBody(plan, { filter: { rawJson: typed } }).inputs);
    expect(wire).toBe(`{"filter":${typed}}`);
  });

  it.fails("W28: does not turn an out-of-range number into null", () => {
    const typed = '{"value":{"limit":1e400}}';
    const wire = JSON.stringify(toExecuteBody(plan, { filter: { rawJson: typed } }).inputs);
    expect(wire).not.toContain("null");
  });
});
