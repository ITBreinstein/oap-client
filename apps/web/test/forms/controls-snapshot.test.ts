/**
 * One line per input of every committed description: the control it gets,
 * and for a geometry its wrapper and types. The file snapshot is the point —
 * a matcher change shows up as a diff of exactly the inputs it moved, so a
 * change outside the inputs it was meant for is visible before review.
 */

import { describe, expect, it } from "vitest";
import { needsOfPlan } from "../../src/app/needs.js";
import { drawsOnMap } from "../../src/app/map-need.js";
import type { Control } from "../../src/forms/plan.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { FIXTURE_DESCRIPTIONS, fixtureProcess } from "./helpers.js";

function describeControl(control: Control): string {
  switch (control.kind) {
    case "list":
      return `list<${describeControl(control.item)}>`;
    case "geometry":
      return `geometry (${control.wrapper}, ${control.geometryTypes.join("|")})`;
    case "complex":
      return `complex (${control.formats.map((format) => format.label).join(", ")})`;
    case "json":
      return `json [${control.reason}]`;
    case "text":
    case "number":
    case "select":
    case "checkbox":
    case "bbox":
      return control.kind;
  }
}

describe("controls per input", () => {
  it("matches the snapshot", async () => {
    const lines: string[] = [];
    for (const key of Object.keys(FIXTURE_DESCRIPTIONS).sort()) {
      const plan = resolveFormPlan(fixtureProcess(key));
      lines.push(`${key} — needs ${needsOfPlan(plan)}`);
      for (const field of plan.fields) {
        const codes = plan.diagnostics
          .filter((diagnostic) => diagnostic.inputId === field.id)
          .map((diagnostic) => diagnostic.code);
        const map = drawsOnMap(field) ? " · map" : "";
        const shown = codes.length === 0 ? "" : ` · ${codes.join(", ")}`;
        lines.push(`  ${key}/${field.id} → ${describeControl(field.control)}${map}${shown}`);
      }
    }
    await expect(`${lines.join("\n")}\n`).toMatchFileSnapshot("__snapshots__/controls.txt");
  });
});
