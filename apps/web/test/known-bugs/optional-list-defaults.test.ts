/**
 * Review (2026-09-30): an optional repeatable input the user never touched.
 *
 * defaults.ts promises "an optional one starts empty and is left out", and
 * an optional boolean gets three states so that leaving it alone never sends
 * `false` over the server's default (R9). A *list* starts with one row made
 * by `initialValue(control.item, true)` (defaults.ts:38) — the item is always
 * treated as required — so the row holds `false` for a boolean item, or the
 * item's schema default, and the encoder sends it.
 */

import { describe, expect, it } from "vitest";
import { initialValues } from "../../src/forms/defaults.js";
import { toExecuteBody } from "../../src/forms/encode.js";
import { planFor } from "../forms/helpers.js";

describe("an optional repeatable input left alone", () => {
  it.fails("W18: does not send [false] for booleans", () => {
    const plan = planFor({
      flags: { schema: { type: "boolean" }, minOccurs: 0, maxOccurs: 5 },
    });
    expect(plan.fields[0]?.control.kind).toBe("list");
    expect(toExecuteBody(plan, initialValues(plan)).inputs).toEqual({});
  });

  it.fails("W18: does not send the item default for an enum", () => {
    const plan = planFor({
      layers: {
        schema: { type: "string", enum: ["roads", "water"], default: "roads" },
        minOccurs: 0,
        maxOccurs: 3,
      },
    });
    expect(toExecuteBody(plan, initialValues(plan)).inputs).toEqual({});
  });

  it.fails("W18: does not send the item default for an array of numbers", () => {
    const plan = planFor({
      weights: { schema: { type: "array", items: { type: "number", default: 1 } }, minOccurs: 0 },
    });
    expect(toExecuteBody(plan, initialValues(plan)).inputs).toEqual({});
  });
});
