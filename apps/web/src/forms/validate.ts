/**
 * The client-side checks (T5): only what the plan states cheaply, and never
 * anything else.
 *
 * Required fields, numeric bounds, `enum` membership, `maxLength`, coordinate
 * counts, list lengths, and that raw JSON parses. Nothing more — no `pattern`,
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

import { isAbsent, isRawJson, type FormValues } from "./encode.js";
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
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
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

function checkControl(control: Control, value: unknown): string | undefined {
  if (isRawJson(value)) return jsonError(value.rawJson);

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
      const counts = control.dimensions.join(" or ");
      if (
        !isJsonArray(coordinates) ||
        !coordinates.every((entry) => typeof entry === "number" && Number.isFinite(entry)) ||
        !control.dimensions.some((count) => count === coordinates.length)
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
      return href === "" && format?.object === true ? jsonError(text) : undefined;
    }
    case "list": {
      const items = (isJsonArray(value) ? value : [value]).filter((item) => !isAbsent(item));
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
    case "checkbox":
    case "geometry":
    case "json":
      return undefined;
  }
}

export function validateForm(plan: FormPlan, values: FormValues): FieldErrors {
  const errors = new Map<string, string>();
  for (const field of plan.fields) {
    const value = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
    const empty =
      isAbsent(value) ||
      (isJsonArray(value) && value.filter((item) => !isAbsent(item)).length === 0);
    if (empty) {
      if (field.required) errors.set(field.id, "Required. Fill this in before running.");
      continue;
    }
    const problem = checkControl(field.control, value);
    if (problem !== undefined) errors.set(field.id, problem);
  }
  return errors;
}
