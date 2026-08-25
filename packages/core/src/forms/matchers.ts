/**
 * The matcher chain: an ordered list of `(schema) => Control | undefined`,
 * first match wins, with a fallback that always matches.
 *
 * Order matters twice over. The format hints run before the type matchers,
 * because `ogc-bbox` and GeoJSON are both `type: "object"` and a generic object
 * rule would eat them. And they run before the unsupported-keyword check,
 * because servers routinely express a geometry as a bare `$ref` to a
 * well-known schema document — treating that as an unsupported keyword would
 * drop the map input for the commonest case in the testbed.
 *
 * This is deliberately not a JSON Schema implementation. `allOf`, `anyOf`,
 * `oneOf`, conditionals and remote `$ref` are detected and refused, not
 * approximated: a wrong control is worse than an honest JSON editor, and the
 * refusal is recorded as a finding.
 */

import {
  isJsonObject,
  type JsonObject,
  readArray,
  readBoolean,
  readNumber,
  readObject,
  readString,
  readTypes,
} from "./json.js";
import type { Control, DiagnosticCode, GeometryType, GeometryWrapper, Option } from "./plan.js";

export interface MatchContext {
  /** Records a degradation against the input being resolved. */
  readonly report: (code: DiagnosticCode, message: string) => void;
  /** Resolves a nested schema, e.g. an array's `items`. */
  readonly nested: (schema: unknown) => Control;
}

export type Matcher = (schema: JsonObject, ctx: MatchContext) => Control | undefined;

const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

const GEOMETRY_TYPES: readonly GeometryType[] = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

/** Keywords the resolver refuses rather than guesses at. */
const UNSUPPORTED_KEYWORDS: readonly string[] = [
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "dependentSchemas",
  "$ref",
];

function jsonControl(schema: JsonObject, reason: string): Control {
  return { kind: "json", reason, schema };
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[-_\s]/g, "");
}

// ---------------------------------------------------------------------------
// Bounding box

function looksLikeBbox(schema: JsonObject): boolean {
  if (readString(schema, "format") === "ogc-bbox") return true;

  const ref = readString(schema, "$ref");
  if (ref !== undefined && /bbox/i.test(ref)) return true;

  // Structural: the OGC bbox schema is an object with a `bbox` array property.
  const properties = readObject(schema, "properties");
  return properties !== undefined && isJsonObject(properties["bbox"]);
}

function readCrsOptions(schema: JsonObject): readonly string[] {
  const crs = readObject(schema, "properties")?.["crs"];
  if (!isJsonObject(crs)) return [CRS84];

  const enumerated = readArray(crs, "enum")?.filter(
    (entry): entry is string => typeof entry === "string",
  );
  if (enumerated !== undefined && enumerated.length > 0) return enumerated;

  const fallback = readString(crs, "default");
  return [fallback ?? CRS84];
}

const matchBbox: Matcher = (schema) =>
  looksLikeBbox(schema) ? { kind: "bbox", crs: readCrsOptions(schema) } : undefined;

// ---------------------------------------------------------------------------
// GeoJSON

interface GeometryHint {
  readonly wrapper: GeometryWrapper;
  readonly geometryTypes: readonly GeometryType[];
}

/** `geojson-geometry`, `geojson-feature`, `geojson-polygon`, … */
function hintFromFormat(format: string): GeometryHint | undefined {
  if (!format.toLowerCase().startsWith("geojson-")) return undefined;
  const suffix = normalise(format.slice("geojson-".length));

  if (suffix === "featurecollection") {
    return { wrapper: "feature-collection", geometryTypes: GEOMETRY_TYPES };
  }
  if (suffix === "feature") return { wrapper: "feature", geometryTypes: GEOMETRY_TYPES };

  const specific = GEOMETRY_TYPES.find((type) => normalise(type) === suffix);
  return {
    wrapper: "geometry",
    geometryTypes: specific === undefined ? GEOMETRY_TYPES : [specific],
  };
}

function hintFromRef(ref: string): GeometryHint | undefined {
  const target = normalise(ref);
  if (target.includes("featurecollectiongeojson")) {
    return { wrapper: "feature-collection", geometryTypes: GEOMETRY_TYPES };
  }
  if (target.includes("featuregeojson")) {
    return { wrapper: "feature", geometryTypes: GEOMETRY_TYPES };
  }
  if (target.includes("geometrygeojson")) {
    return { wrapper: "geometry", geometryTypes: GEOMETRY_TYPES };
  }
  return undefined;
}

const matchGeometry: Matcher = (schema) => {
  const format = readString(schema, "format");
  const byFormat = format === undefined ? undefined : hintFromFormat(format);
  if (byFormat !== undefined) return { kind: "geometry", ...byFormat };

  const ref = readString(schema, "$ref");
  const byRef = ref === undefined ? undefined : hintFromRef(ref);
  if (byRef !== undefined) return { kind: "geometry", ...byRef };

  // A media type alone does not say whether the server wants a bare geometry or
  // a feature. We assume a geometry; which servers disagree is a finding.
  if (readString(schema, "contentMediaType") === "application/geo+json") {
    return { kind: "geometry", wrapper: "geometry", geometryTypes: GEOMETRY_TYPES };
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Refusals

const matchUnsupportedKeyword: Matcher = (schema, ctx) => {
  const found = UNSUPPORTED_KEYWORDS.find((keyword) => keyword in schema);
  if (found === undefined) return undefined;

  const reason =
    found === "$ref"
      ? `\`$ref\` to an unrecognised schema (${readString(schema, "$ref") ?? "?"})`
      : `\`${found}\` is outside the supported JSON Schema subset`;
  ctx.report("unsupported-keyword", reason);
  return jsonControl(schema, reason);
};

// ---------------------------------------------------------------------------
// Types

// `enum` values come out of a parsed JSON document, so they are never
// `undefined` — the one input for which JSON.stringify returns undefined.
function labelFor(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

const matchEnum: Matcher = (schema) => {
  const values = readArray(schema, "enum");
  if (values === undefined || values.length === 0) return undefined;

  const options: readonly Option[] = values.map((value) => ({ value, label: labelFor(value) }));
  return "default" in schema
    ? { kind: "select", options, default: schema["default"] }
    : { kind: "select", options };
};

const matchBoolean: Matcher = (schema) =>
  readTypes(schema).includes("boolean")
    ? { kind: "checkbox", default: readBoolean(schema, "default") }
    : undefined;

const matchNumber: Matcher = (schema) => {
  const types = readTypes(schema);
  const integer = types.includes("integer");
  if (!integer && !types.includes("number")) return undefined;

  return {
    kind: "number",
    integer,
    min: readNumber(schema, "minimum"),
    max: readNumber(schema, "maximum"),
    step: readNumber(schema, "multipleOf"),
    default: readNumber(schema, "default"),
  };
};

const matchString: Matcher = (schema) =>
  readTypes(schema).includes("string")
    ? {
        kind: "text",
        default: readString(schema, "default"),
        format: readString(schema, "format"),
        pattern: readString(schema, "pattern"),
        minLength: readNumber(schema, "minLength"),
        maxLength: readNumber(schema, "maxLength"),
      }
    : undefined;

const matchArray: Matcher = (schema, ctx) =>
  readTypes(schema).includes("array")
    ? {
        kind: "list",
        item: ctx.nested(schema["items"]),
        minItems: readNumber(schema, "minItems"),
        maxItems: readNumber(schema, "maxItems"),
      }
    : undefined;

/**
 * The chain, in the order it runs. A new control kind is a new entry here plus
 * its own test row — never a branch inside an existing matcher.
 */
export const MATCHERS: readonly Matcher[] = [
  matchBbox,
  matchGeometry,
  matchUnsupportedKeyword,
  matchEnum,
  matchBoolean,
  matchNumber,
  matchString,
  matchArray,
];

/** Runs when nothing above matched. Always produces a control. */
export function fallbackControl(schema: JsonObject, ctx: MatchContext): Control {
  const types = readTypes(schema);
  const reason =
    types.length > 0
      ? `no control for type \`${types.join(" | ")}\``
      : "the schema declares no type this client recognises";
  ctx.report("unsupported-type", reason);
  return jsonControl(schema, reason);
}
