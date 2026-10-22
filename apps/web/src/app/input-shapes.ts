/**
 * How a field holds GeoJSON the map can draw: a geometry field, or a complex
 * field's JSON-object format given inline. `MapPane` draws and edits through
 * it; the record of what was sent asks it whether the map shows a value.
 * No map import here, so neither needs the map to ask.
 */

import type { ComplexValue, GeoJsonText } from "../forms/encode.js";
import { ANY_FEATURE_COLLECTION, shapesOfText, type GeometryTarget } from "../forms/geometry.js";
import type { FieldPlan } from "../forms/plan.js";
import { positionCount } from "../results/plottable.js";

function readText(record: unknown, key: string): string | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const text: unknown = (record as Record<string, unknown>)[key];
  return typeof text === "string" ? text : undefined;
}

function readFormat(record: unknown): number {
  if (typeof record !== "object" || record === null) return 0;
  const format: unknown = (record as Record<string, unknown>)["format"];
  return typeof format === "number" ? format : 0;
}

/** How a field holds GeoJSON, if the map can draw for it in its current state. */
export interface ShapeBinding {
  readonly target: GeometryTarget;
  readonly text: string;
  readonly write: (text: string) => unknown;
}

export function shapeBinding(field: FieldPlan, current: unknown): ShapeBinding | undefined {
  const { control } = field;
  if (control.kind === "geometry") {
    return {
      target: control,
      text: readText(current, "geojson") ?? "",
      write: (text) => {
        const value: GeoJsonText = { geojson: text };
        return text === "" ? undefined : value;
      },
    };
  }
  if (control.kind === "complex") {
    const format = readFormat(current);
    if (control.formats[format]?.object !== true || readText(current, "href") !== undefined) {
      return undefined;
    }
    return {
      target: ANY_FEATURE_COLLECTION,
      text: readText(current, "value") ?? "",
      write: (text) => {
        const value: ComplexValue = { format, value: text };
        return value;
      },
    };
  }
  return undefined;
}

/**
 * Whether the map draws this value as the input's dashed outline: it holds
 * shapes, and no more positions than the page draws (`map-limits.ts`).
 */
export function shownOnMap(field: FieldPlan, value: unknown, maxCoordinates: number): boolean {
  const binding = shapeBinding(field, value);
  if (binding === undefined) return false;
  const shapes = shapesOfText(binding.text);
  return shapes.length > 0 && positionCount(shapes) <= maxCoordinates;
}
