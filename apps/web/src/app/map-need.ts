/**
 * When the page shows the map: only while it has a job to do.
 *
 * - Before a process is open (start screen, process list): never.
 * - With a process open: when one of its inputs can be drawn on the map — a
 *   bounding box, a geometry (repeatable or not), or a complex input with a
 *   JSON-object format, which the map draws as GeoJSON. These are exactly the fields `MapPane`
 *   binds to, so a "Draw on the map" button never appears without a map.
 * - With a result in: also when the result can be drawn — GeoJSON within the
 *   page's coordinate limit, or an image with a box that places it.
 *
 * A process with neither (a greeting, a PNG, a table) runs from start to
 * finish without a map. A process with no spatial input but a GeoJSON result
 * gains the map the moment that result arrives.
 *
 * Derived from the workflow on every render, never stored, like the rest of
 * what the map shows (`MapPane.shownFor`).
 */

import type { FieldPlan } from "../forms/plan.js";
import { mapImage, plottedShapes } from "../results/plottable.js";
import type { Workflow } from "./workflow.js";

/** Whether the map can draw this field's value. */
export function drawsOnMap(field: FieldPlan): boolean {
  const { control } = field;
  switch (control.kind) {
    case "bbox":
    case "geometry":
      return true;
    case "complex":
      return control.formats.some((format) => format.object);
    // One row at a time (`DrawTarget.row`).
    case "list":
      return control.item.kind === "geometry";
    // Listed rather than left to a `default`, so a new kind of control has to
    // be decided on here before the page compiles.
    case "text":
    case "number":
    case "select":
    case "checkbox":
    case "json":
      return false;
  }
}

/** Whether the map should be on screen for this state of the workflow. */
export function mapNeeded(state: Workflow, maxCoordinates: number): boolean {
  if (state.stage === "choose-endpoint" || state.stage === "connected") return false;
  if (state.plan.fields.some(drawsOnMap)) return true;
  if (state.stage !== "result") return false;
  return (
    plottedShapes(state.results, maxCoordinates).length > 0 || mapImage(state.results) !== undefined
  );
}
