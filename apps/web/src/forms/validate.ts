/**
 * The client-side checks (T5): only what the plan states cheaply, and never
 * anything else.
 *
 * Required fields, numeric bounds, `enum` membership, `maxLength`, coordinate
 * counts, list lengths, and that raw JSON parses and can be sent as written.
 * Nothing more — no `pattern`,
 * no `format`, no URL shape — because the server is authoritative and a client
 * that refuses what the server would accept is worse than one that lets the
 * server say no.
 *
 * Z5 is why these matter at all: neither reference server validates an input
 * against its own schema. pygeoapi accepts a wrong type, an out-of-range
 * number, an unknown enum value, an over-long string, a missing required input
 * and too many occurrences, all with 200; ZOO accepts most of those too, and
 * answers some with an HTML 500 from the process itself. These checks are the
 * only validation a user gets before the server runs something.
 *
 * The messages say what is wrong and what to do; they never apologise (T11).
 */

import { classifyCrs } from "./crs.js";
import { isAbsentFor, isGeoJsonText, isRawJson, type FormValues } from "./encode.js";
import { inexactNumbers } from "./exact-json.js";
import { shapesOfText } from "./geometry.js";
import { isJsonArray, isJsonObject } from "./json.js";
import type { Control, FormPlan, NumberControl } from "./plan.js";

/** Keyed by field id. A `Map`, so an id like `__proto__` is an ordinary key. */
export type FieldErrors = ReadonlyMap<string, string>;

function describeRange(control: NumberControl): string {
  const { min, max } = control;
  const lower =
    min === undefined ? "" : control.minExclusive ? `above ${String(min)}` : String(min);
  const upper =
    max === undefined ? "" : control.maxExclusive ? `below ${String(max)}` : String(max);
  if (lower !== "" && upper !== "") {
    return control.minExclusive || control.maxExclusive
      ? `${lower} and ${upper}`
      : `from ${lower} to ${upper}`;
  }
  if (lower !== "") return control.minExclusive ? lower : `${lower} or more`;
  if (upper !== "") return control.maxExclusive ? upper : `${upper} or less`;
  return "";
}

function checkNumber(control: NumberControl, value: unknown): string | undefined {
  const text = String(value).trim();
  // `Number("")` is 0, which would pass (W27).
  const parsed = typeof value === "number" ? value : text === "" ? Number.NaN : Number(text);
  const kind = control.integer ? "a whole number" : "a number";
  const range = describeRange(control);
  const ask = `Enter ${kind}${range === "" ? "" : ` ${range}`}.`;
  if (!Number.isFinite(parsed)) return ask;
  if (control.integer && !Number.isInteger(parsed)) return ask;
  const { min, max } = control;
  if (min !== undefined && (control.minExclusive ? parsed <= min : parsed < min)) return ask;
  if (max !== undefined && (control.maxExclusive ? parsed >= max : parsed > max)) return ask;
  return undefined;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function jsonError(text: string): string | undefined {
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `This is not valid JSON (${detail}). Correct it, or clear the field.`;
  }
}

/**
 * JSON the user typed as the wire value, holding a number this browser would
 * send as another (W28): it cannot keep a number as written, so the promise
 * "sent as typed" would not hold. Not asked of a geometry, whose coordinates
 * past a double's precision mean nothing.
 */
function inexactError(text: string): string | undefined {
  const [first, ...more] = inexactNumbers(text);
  if (first === undefined) return undefined;
  const also =
    more.length === 0
      ? ""
      : ` ${String(more.length)} more ${more.length === 1 ? "number" : "numbers"} would change too.`;
  return `This browser would send ${first.written} as ${first.sent}.${also} Open the page in a current browser, or write the number as a string if the process accepts one.`;
}

function checkControl(control: Control, value: unknown): string | undefined {
  if (isRawJson(value)) return jsonError(value.rawJson) ?? inexactError(value.rawJson);

  switch (control.kind) {
    case "number":
      return checkNumber(control, value);
    case "select":
      return control.options.some((option) => sameValue(option.value, value))
        ? undefined
        : "Choose one of the listed values.";
    case "text": {
      // Code points, which is what JSON Schema counts for `maxLength`.
      const length = Array.from(String(value)).length;
      return control.maxLength !== undefined && length > control.maxLength
        ? `Use at most ${String(control.maxLength)} characters; this has ${String(length)}.`
        : undefined;
    }
    case "bbox": {
      const coordinates: unknown =
        isJsonObject(value) && "coordinates" in value ? value["coordinates"] : value;
      const crs: unknown = isJsonObject(value) ? value["crs"] : undefined;
      // A CRS that says how many numbers a box has decides, where the input
      // allows that many; otherwise any count the input allows. Six numbers
      // labelled CRS84, or four labelled CRS84h, are refused rather than sent
      // (W20).
      const kind = typeof crs === "string" ? classifyCrs(crs) : "unknown";
      const implied =
        kind === "crs84h" ? 6 : kind === "crs84" || kind === "epsg4326" ? 4 : undefined;
      const allowed =
        implied !== undefined && control.dimensions.includes(implied)
          ? [implied]
          : control.dimensions;
      const counts = allowed.join(" or ");
      if (
        !isJsonArray(coordinates) ||
        !coordinates.every((entry) => typeof entry === "number" && Number.isFinite(entry)) ||
        !allowed.some((count) => count === coordinates.length)
      ) {
        return `Draw a box on the map, or enter all ${counts} coordinates.`;
      }
      return undefined;
    }
    case "complex": {
      if (!isJsonObject(value)) return undefined;
      const format = control.formats[typeof value["format"] === "number" ? value["format"] : 0];
      const href = typeof value["href"] === "string" ? value["href"].trim() : "";
      const text = typeof value["value"] === "string" ? value["value"] : "";
      return href === "" && format?.object === true
        ? (jsonError(text) ?? inexactError(text))
        : undefined;
    }
    case "list": {
      const items = (isJsonArray(value) ? value : [value]).filter(
        (item) => !isAbsentFor(control.item, item),
      );
      if (control.minItems !== undefined && items.length < control.minItems) {
        return `Give at least ${String(control.minItems)} values.`;
      }
      if (control.maxItems !== undefined && items.length > control.maxItems) {
        return `Give at most ${String(control.maxItems)} values; remove ${String(items.length - control.maxItems)}.`;
      }
      for (const [index, item] of items.entries()) {
        const problem = checkControl(control.item, item);
        if (problem !== undefined) return `Value ${String(index + 1)}: ${problem}`;
      }
      return undefined;
    }
    case "geometry": {
      if (!isGeoJsonText(value)) return undefined;
      return (
        jsonError(value.geojson) ??
        (shapesOfText(value.geojson).length === 0
          ? "This holds no GeoJSON geometry. Draw a shape on the map, or load a GeoJSON file."
          : undefined)
      );
    }
    case "checkbox":
    case "json":
      return undefined;
  }
}

export function validateForm(plan: FormPlan, values: FormValues): FieldErrors {
  const errors = new Map<string, string>();
  for (const field of plan.fields) {
    const value = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
    const { control } = field;
    const item = control.kind === "list" ? control.item : control;
    const empty =
      isAbsentFor(control, value) ||
      (isJsonArray(value) && value.every((entry) => isAbsentFor(item, entry)));
    if (empty) {
      if (field.required) errors.set(field.id, "Required. Fill this in before running.");
      continue;
    }
    const problem = checkControl(field.control, value);
    if (problem !== undefined) errors.set(field.id, problem);
  }
  return errors;
}
