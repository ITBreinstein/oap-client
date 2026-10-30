/**
 * How a field holds GeoJSON the map can draw: a geometry field, one row of a
 * repeatable geometry field, or a complex field's JSON-object format given
 * inline. `MapPane` draws and edits through it; the record of what was sent
 * asks it whether the map shows a value. No map import here, so neither needs
 * the map to ask.
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

function geoJsonValue(text: string): GeoJsonText | undefined {
  return text === "" ? undefined : { geojson: text };
}

/** A repeatable input's rows, as the list holds them: a lone value is a list of one. */
function rowsOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

/**
 * The map draws for one field — for a repeatable geometry field, for one of its
 * rows, `row`: the others stay as they are.
 */
export function shapeBinding(
  field: FieldPlan,
  current: unknown,
  row?: number,
): ShapeBinding | undefined {
  const { control } = field;
  if (control.kind === "geometry") {
    return {
      target: control,
      text: readText(current, "geojson") ?? "",
      write: geoJsonValue,
    };
  }
  if (control.kind === "list" && control.item.kind === "geometry") {
    const rows = rowsOf(current);
    if (row === undefined || row < 0 || row >= rows.length) return undefined;
    return {
      target: control.item,
      text: readText(rows[row], "geojson") ?? "",
      write: (text) => rows.map((item, at) => (at === row ? geoJsonValue(text) : item)),
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

/** GeoJSON the map can show for a field, and which row of a repeatable one it is. */
export interface FieldText {
  readonly text: string;
  readonly row?: number | undefined;
}

/**
 * Every GeoJSON text a field holds that the map can show: its one value, or
 * each row of a repeatable geometry field but `except`, the row being drawn.
 */
export function fieldTexts(field: FieldPlan, current: unknown, except?: number): FieldText[] {
  const { control } = field;
  if (control.kind === "list" && control.item.kind === "geometry") {
    return rowsOf(current).flatMap((item, row) =>
      row === except ? [] : [{ text: readText(item, "geojson") ?? "", row }],
    );
  }
  const binding = shapeBinding(field, current);
  return binding === undefined ? [] : [{ text: binding.text }];
}

/**
 * Whether the map draws this value as the input's dashed outline: it holds
 * shapes, and no more positions than the page draws (`map-limits.ts`). For a
 * repeatable geometry input, whether it draws any row.
 */
export function shownOnMap(field: FieldPlan, value: unknown, maxCoordinates: number): boolean {
  return fieldTexts(field, value).some(({ text }) => {
    const shapes = shapesOfText(text);
    return shapes.length > 0 && positionCount(shapes) <= maxCoordinates;
  });
}
