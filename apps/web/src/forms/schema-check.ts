/**
 * A value checked against an input's JSON Schema, for warnings only
 * (package 6, finding 0054: neither reference server validates an input
 * against its own description).
 *
 * Not a validator in the sense of `validate.ts`, which blocks a run on the few
 * checks the form plan states cheaply. This says what the description asks
 * for, and the run goes ahead regardless: the server is authoritative, and a
 * description may be wrong.
 *
 * A subset of JSON Schema, interpreted directly — no dependency, and no
 * generated code, so it runs under a content security policy that forbids
 * `eval`. Keywords it does not know are ignored, as JSON Schema says unknown
 * keywords are. Where it cannot check honestly it says so instead of guessing:
 *
 * - `$ref`: the target is not fetched, so the schema behind it is unknown;
 * - `pattern`: a regular expression this browser cannot compile;
 * - `size`: a value too large to walk while the user types.
 *
 * Pure: no React, no DOM, no network. It never throws.
 */

import { isJsonArray, isJsonObject } from "./json.js";

export type SchemaCheck =
  | { readonly kind: "checked"; readonly problems: readonly string[] }
  /** The keyword that stopped the check: `$ref`, `pattern` or `size`. */
  | { readonly kind: "not-checked"; readonly keyword: string };

/** Nodes of a value visited before the check gives up as `size`. */
export const MAX_VISITS = 20_000;
/** Schema nesting followed before giving up, against a schema that nests without end. */
const MAX_DEPTH = 32;
/** Problems reported per value; the first few say enough. */
const MAX_PROBLEMS = 5;

class NotChecked extends Error {
  readonly keyword: string;
  constructor(keyword: string) {
    super(keyword);
    this.keyword = keyword;
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
    case "boolean":
    case "object":
    case "array":
    case "null":
      return typeOf(value) === type;
    default:
      // A type name JSON Schema does not have: nothing to check against.
      return true;
  }
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isJsonArray(a) && isJsonArray(b)) {
    return a.length === b.length && a.every((entry, index) => equal(entry, b[index]));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}

function show(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

function compile(pattern: string): RegExp {
  // JSON Schema patterns are ECMA-262 regular expressions; the `u` flag
  // reads them as Unicode, and some older ones compile only without it.
  try {
    return new RegExp(pattern, "u");
  } catch {
    try {
      return new RegExp(pattern);
    } catch {
      throw new NotChecked("pattern");
    }
  }
}

interface Walk {
  visits: number;
}

const ROOT = "The value";

/** Where a nested value is: `address.street`, `coordinates[0][1]`. */
function child(at: string, step: string | number): string {
  const base = at === ROOT ? "" : at;
  if (typeof step === "number") {
    return base === "" ? `Item ${String(step + 1)}` : `${base}[${String(step)}]`;
  }
  return base === "" ? step : `${base}.${step}`;
}

function number(schema: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = schema[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function problemsOf(
  schema: unknown,
  value: unknown,
  at: string,
  depth: number,
  walk: Walk,
): string[] {
  walk.visits += 1;
  if (walk.visits > MAX_VISITS) throw new NotChecked("size");
  if (depth > MAX_DEPTH) throw new NotChecked("size");
  if (schema === false) return [`${at} is not allowed.`];
  if (!isJsonObject(schema)) return [];
  if (typeof schema["$ref"] === "string") throw new NotChecked("$ref");

  const problems: string[] = [];
  const say = (text: string) => problems.push(`${at} ${text}`);

  const type = schema["type"];
  const types =
    typeof type === "string"
      ? [type]
      : isJsonArray(type)
        ? type.filter((t) => typeof t === "string")
        : [];
  if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
    say(`should be ${types.join(" or ")}, not ${typeOf(value)}.`);
    // Everything below assumes the right type; saying more would only repeat this.
    return problems;
  }

  const allowed = schema["enum"];
  if (isJsonArray(allowed) && !allowed.some((entry) => equal(entry, value))) {
    say(`should be one of ${allowed.slice(0, 8).map(show).join(", ")}.`);
  }
  if (Object.hasOwn(schema, "const") && !equal(schema["const"], value)) {
    say(`should be ${show(schema["const"])}.`);
  }

  if (typeof value === "number") {
    const minimum = number(schema, "minimum");
    const maximum = number(schema, "maximum");
    const exclusiveMin = schema["exclusiveMinimum"];
    const exclusiveMax = schema["exclusiveMaximum"];
    // Draft 4 spells exclusivity as a boolean beside minimum and maximum.
    const lowerOpen = exclusiveMin === true;
    const upperOpen = exclusiveMax === true;
    if (minimum !== undefined && (lowerOpen ? value <= minimum : value < minimum)) {
      say(`should be ${lowerOpen ? "above" : "at least"} ${String(minimum)}.`);
    }
    if (maximum !== undefined && (upperOpen ? value >= maximum : value > maximum)) {
      say(`should be ${upperOpen ? "below" : "at most"} ${String(maximum)}.`);
    }
    if (typeof exclusiveMin === "number" && value <= exclusiveMin) {
      say(`should be above ${String(exclusiveMin)}.`);
    }
    if (typeof exclusiveMax === "number" && value >= exclusiveMax) {
      say(`should be below ${String(exclusiveMax)}.`);
    }
    const multipleOf = number(schema, "multipleOf");
    if (multipleOf !== undefined && multipleOf > 0) {
      const ratio = value / multipleOf;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        say(`should be a multiple of ${String(multipleOf)}.`);
      }
    }
  }

  if (typeof value === "string") {
    // Characters as JSON Schema counts them: code points, so a surrogate pair is one.
    const length = value.length - (value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
    const minLength = number(schema, "minLength");
    const maxLength = number(schema, "maxLength");
    if (minLength !== undefined && length < minLength) {
      say(`should be at least ${String(minLength)} characters long.`);
    }
    if (maxLength !== undefined && length > maxLength) {
      say(`should be at most ${String(maxLength)} characters long.`);
    }
    const pattern = schema["pattern"];
    if (typeof pattern === "string" && !compile(pattern).test(value)) {
      say(`should match the pattern ${pattern}.`);
    }
  }

  if (isJsonArray(value)) {
    const minItems = number(schema, "minItems");
    const maxItems = number(schema, "maxItems");
    if (minItems !== undefined && value.length < minItems) {
      say(`should have at least ${String(minItems)} items.`);
    }
    if (maxItems !== undefined && value.length > maxItems) {
      say(`should have at most ${String(maxItems)} items.`);
    }
    if (
      schema["uniqueItems"] === true &&
      value.some((entry, index) => value.slice(index + 1).some((other) => equal(entry, other)))
    ) {
      say("should not repeat an item.");
    }
    // `prefixItems` (2020-12), or `items` as a list (draft 4 to 2019-09).
    const prefix = isJsonArray(schema["prefixItems"])
      ? schema["prefixItems"]
      : isJsonArray(schema["items"])
        ? schema["items"]
        : [];
    const rest = isJsonArray(schema["items"]) ? schema["additionalItems"] : schema["items"];
    value.forEach((entry, index) => {
      const itemSchema = index < prefix.length ? prefix[index] : rest;
      if (itemSchema !== undefined) {
        problems.push(...problemsOf(itemSchema, entry, child(at, index), depth + 1, walk));
      }
    });
  }

  if (isJsonObject(value)) {
    const required = schema["required"];
    if (isJsonArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !Object.hasOwn(value, key)) say(`should have "${key}".`);
      }
    }
    const properties = isJsonObject(schema["properties"]) ? schema["properties"] : {};
    const additional = schema["additionalProperties"];
    for (const [key, member] of Object.entries(value)) {
      const where = child(at, key);
      if (Object.hasOwn(properties, key)) {
        problems.push(...problemsOf(properties[key], member, where, depth + 1, walk));
      } else if (additional === false) {
        say(`should not have "${key}".`);
      } else if (isJsonObject(additional)) {
        problems.push(...problemsOf(additional, member, where, depth + 1, walk));
      }
    }
    const count = Object.keys(value).length;
    const minProperties = number(schema, "minProperties");
    const maxProperties = number(schema, "maxProperties");
    if (minProperties !== undefined && count < minProperties) {
      say(`should have at least ${String(minProperties)} members.`);
    }
    if (maxProperties !== undefined && count > maxProperties) {
      say(`should have at most ${String(maxProperties)} members.`);
    }
  }

  const allOf = schema["allOf"];
  if (isJsonArray(allOf)) {
    for (const part of allOf) problems.push(...problemsOf(part, value, at, depth + 1, walk));
  }
  const anyOf = schema["anyOf"];
  if (isJsonArray(anyOf) && anyOf.length > 0) {
    if (!anyOf.some((part) => problemsOf(part, value, at, depth + 1, walk).length === 0)) {
      say("matches none of the forms the description allows.");
    }
  }
  const oneOf = schema["oneOf"];
  if (isJsonArray(oneOf) && oneOf.length > 0) {
    const passing = oneOf.filter(
      (part) => problemsOf(part, value, at, depth + 1, walk).length === 0,
    ).length;
    // Only "none": OGC descriptions list encodings as `oneOf` branches that
    // differ by `contentMediaType` alone, an annotation, so a text value
    // matches several of them by design. Holding them to "exactly one" would
    // warn about every such input.
    if (passing === 0) say("matches none of the forms the description allows.");
  }
  const not = schema["not"];
  if (not !== undefined && problemsOf(not, value, at, depth + 1, walk).length === 0) {
    say("is a value the description rules out.");
  }

  return problems;
}

/** Check `value` against `schema`. Never throws. */
export function checkAgainstSchema(schema: unknown, value: unknown): SchemaCheck {
  try {
    const problems = problemsOf(schema, value, ROOT, 0, { visits: 0 });
    return { kind: "checked", problems: problems.slice(0, MAX_PROBLEMS) };
  } catch (error) {
    if (error instanceof NotChecked) return { kind: "not-checked", keyword: error.keyword };
    // Nothing above should throw anything else; if it does, it is not a check.
    return { kind: "not-checked", keyword: "error" };
  }
}
