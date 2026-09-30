/**
 * Review (2026-09-30): a number field holding only whitespace.
 *
 * validate.ts:46 reads it as `Number("")`, which is 0, so the check passes;
 * encode.ts:155-159 leaves text that trims to "" alone, so the request
 * carries the string " " for a number input. `isAbsent` only treats "" (not
 * " ") as not supplied.
 */

import { describe, expect, it } from "vitest";
import { toExecuteBody } from "../../src/forms/encode.js";
import { validateForm } from "../../src/forms/validate.js";
import { planFor } from "../forms/helpers.js";

describe("a number field holding a space", () => {
  const plan = planFor({
    distance: { schema: { type: "number", minimum: 1 } },
    count: { schema: { type: "integer" }, minOccurs: 0 },
  });

  it.fails("W27: is refused before sending when required", () => {
    // No bounds: Number(" ".trim()) is 0, a finite number, so the check passes.
    const unbounded = planFor({ distance: { schema: { type: "number" } } });
    expect(validateForm(unbounded, { distance: " " }).has("distance")).toBe(true);
  });

  it.fails("W27: is left out, not sent as a string, when optional", () => {
    const values = { distance: "5", count: "  " };
    expect(validateForm(plan, values).size).toBe(0);
    expect(toExecuteBody(plan, values).inputs).toEqual({ distance: 5 });
  });
});
