/**
 * `minOccurs` / `maxOccurs` → `required` / `multiple`.
 *
 * Small enough to inline at the call site, and deliberately not inlined,
 * because the defaults are a trap worth isolating and testing on its own.
 *
 * **The OGC defaults are the opposite of what a JSON Schema reader expects.**
 * Both `minOccurs` and `maxOccurs` default to `1`, so *an input with neither
 * field is required*. JSON Schema expresses required-ness with a separate
 * `required: []` array at the object level; OGC API - Processes does not use
 * that here. A parser written by someone thinking in JSON Schema produces a
 * form where every field is optional, the user submits an empty one, and the
 * server returns an error nobody can explain during a demo.
 *
 * That default is load-bearing against both reference servers: 1 541 of ZOO's
 * 5 098 inputs omit `minOccurs` entirely, and 4 947 omit `maxOccurs`.
 *
 * A malformed value falls back to the spec default rather than throwing. Some
 * servers emit `"minOccurs": "1"` as a string, and a process that spells one
 * number wrongly should still be usable.
 */

/** What the OGC schema says when the member is absent. */
export const DEFAULT_MIN_OCCURS = 1;
export const DEFAULT_MAX_OCCURS = 1;

/** The literal `maxOccurs` uses for "no upper limit". */
export const UNBOUNDED = "unbounded";

export interface Cardinality {
  readonly minOccurs: number;
  /**
   * A union of a primitive and a *literal* type, so `"unbounded"` is the only
   * string that fits. Every read must handle both arms: `maxOccurs > 1` alone
   * is a bug, because comparing a string to a number silently yields `false`.
   */
  readonly maxOccurs: number | "unbounded";
  readonly required: boolean;
  readonly multiple: boolean;
}

/** Codes describing which value was rejected, for the warnings list. */
export type CardinalityWarning = "min-occurs-not-an-integer" | "max-occurs-not-an-integer";

export interface NormalisedCardinality {
  readonly cardinality: Cardinality;
  /** Empty when both values were absent or well-formed. */
  readonly warnings: readonly CardinalityWarning[];
}

function isCount(value: unknown, floor: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= floor;
}

/**
 * Normalise, and say what was wrong.
 *
 * *Absent* is not a warning — it is the overwhelmingly common case and the spec
 * defines it. *Present and unusable* is, because it means the server sent
 * something it meant us to read.
 */
export function normaliseCardinality(rawMin: unknown, rawMax: unknown): NormalisedCardinality {
  const warnings: CardinalityWarning[] = [];

  let minOccurs = DEFAULT_MIN_OCCURS;
  if (isCount(rawMin, 0)) {
    minOccurs = rawMin;
  } else if (rawMin !== undefined) {
    warnings.push("min-occurs-not-an-integer");
  }

  let maxOccurs: number | "unbounded" = DEFAULT_MAX_OCCURS;
  if (rawMax === UNBOUNDED) {
    maxOccurs = UNBOUNDED;
  } else if (isCount(rawMax, 1)) {
    maxOccurs = rawMax;
  } else if (rawMax !== undefined) {
    warnings.push("max-occurs-not-an-integer");
  }

  return {
    cardinality: {
      minOccurs,
      maxOccurs,
      required: minOccurs >= 1,
      multiple: maxOccurs === UNBOUNDED || maxOccurs > 1,
    },
    warnings,
  };
}
