/**
 * What a process needs from the person running it, in three words a first
 * visitor can choose by: an area drawn on the map, data to upload, or just
 * values typed in.
 *
 * Known for a process only when this page has its description (opened this
 * visit) or an example in `config.json` says so. Never fetched to fill a
 * column: a catalogue can list hundreds of processes.
 */

import type { Control, FormPlan } from "../forms/plan.js";

export type Needs = "area" | "data" | "values";

export const NEEDS: readonly Needs[] = ["area", "data", "values"];

export const NEEDS_LABELS: Readonly<Record<Needs, string>> = {
  area: "Draw an area",
  data: "Upload data",
  values: "Just values",
};

/** STYLE TRIAL: the word the updated Instrument shows beside the mark (#8). */
export const NEEDS_SHORT: Readonly<Record<Needs, string>> = {
  area: "Area",
  data: "Data",
  values: "Values",
};

export function isNeeds(value: unknown): value is Needs {
  return NEEDS.some((needs) => needs === value);
}

function leaf(control: Control): Control {
  return control.kind === "list" ? leaf(control.item) : control;
}

/**
 * What a form asks for, the most demanding first: an area (a bounding box or
 * a geometry), else data (a complex input, typed or uploaded), else values.
 */
export function needsOfPlan(plan: FormPlan): Needs {
  const kinds = plan.fields.map((field) => leaf(field.control).kind);
  if (kinds.some((kind) => kind === "bbox" || kind === "geometry")) return "area";
  if (kinds.includes("complex")) return "data";
  return "values";
}
