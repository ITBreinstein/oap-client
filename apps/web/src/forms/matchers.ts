/**
 * The matcher chain: an ordered list of `(schema) => Control | undefined`,
 * first match wins, with a fallback that always matches.
 *
 * Order matters twice over. The format hints run before the type matchers,
 * because `ogc-bbox` and GeoJSON are both `type: "object"` and a generic object
 * rule would eat them. And they run before the unsupported-keyword check,
 * because the standard's own bounding box is an `allOf` of the format hint and
 * a `$ref` to `bbox.yaml` (N1), and a complex input is a `oneOf` of encodings
 * (T3) — refusing either as an unsupported keyword would drop the two commonest
 * shapes in the testbed.
 *
 * This is deliberately not a JSON Schema implementation. Beyond those two
 * recognised patterns, `allOf`, `anyOf`, `oneOf`, conditionals and remote
 * `$ref` are detected and refused, not approximated: a wrong control is worse
 * than an honest JSON editor, and the refusal is recorded as a finding.
 */

import { CRS84, CRS84H } from "./crs.js";
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
import type {
  BboxDimension,
  ComplexFormat,
  Control,
  DiagnosticCode,
  GeometryType,
  GeometryWrapper,
  Option,
} from "./plan.js";

export interface MatchContext {
  /** Records a degradation against the input being resolved. */
  readonly report: (code: DiagnosticCode, message: string, keyword?: string) => void;
  /** Resolves a nested schema, e.g. an array's `items`. */
  readonly nested: (schema: unknown) => Control;
}

export type Matcher = (schema: JsonObject, ctx: MatchContext) => Control | undefined;

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

/**
 * Never throws, so the resolver cannot (N6). `JSON.stringify` does throw, on a
 * cyclic value, which cannot arrive over the wire but can be handed in.
 */
function labelFor(value: unknown): string {
  if (typeof value === "string") return value;
  // The three things JSON.stringify answers with undefined, despite its type.
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    // A cyclic value. It has no faithful label, so it gets an honest one.
    return "(a value that cannot be shown)";
  }
}

// ---------------------------------------------------------------------------
// Bounding box

/** The OGC schema document itself: `…/openapi/schemas/bbox.yaml`, however reached. */
const BBOX_SCHEMA_DOCUMENT = /(?:^|\/)bbox\.(?:ya?ml|json)$/i;

function isBboxSchemaRef(ref: string | undefined): boolean {
  if (ref === undefined) return false;
  const [document = ""] = ref.split("#");
  return BBOX_SCHEMA_DOCUMENT.test(document);
}

/** The schema and, for the standard's `allOf` form, each of its members. */
function membersOf(schema: JsonObject): readonly JsonObject[] {
  const allOf = readArray(schema, "allOf")?.filter(isJsonObject) ?? [];
  return [schema, ...allOf];
}

/**
 * Structural: an object whose only properties are a `bbox` array and a `crs`.
 * Tighter than the prototype's "any object with a `bbox` property" (R11): a
 * GeoJSON Feature has a `bbox` member too, and is not a bounding box.
 */
function hasBboxShape(member: JsonObject): boolean {
  const properties = readObject(member, "properties");
  const bbox = properties?.["bbox"];
  if (properties === undefined || !isJsonObject(bbox)) return false;
  const arrayLike = readTypes(bbox).includes("array") || "items" in bbox;
  return arrayLike && Object.keys(properties).every((key) => key === "bbox" || key === "crs");
}

function readCrsOptions(
  properties: JsonObject | undefined,
  wellKnown: boolean,
): { crs: readonly string[]; defaultCrs: string } {
  const crs = properties?.["crs"];
  if (!isJsonObject(crs)) {
    // The OGC bbox.yaml, reached by reference, is known: CRS84 or CRS84h.
    return wellKnown
      ? { crs: [CRS84, CRS84H], defaultCrs: CRS84 }
      : { crs: [CRS84], defaultCrs: CRS84 };
  }
  const enumerated =
    readArray(crs, "enum")?.filter((entry): entry is string => typeof entry === "string") ?? [];
  const declaredDefault = readString(crs, "default");
  if (enumerated.length > 0) {
    // R5: the declared default survives an enum, so the form preselects what
    // the server would have chosen rather than whatever it listed first.
    const first = enumerated[0] ?? CRS84;
    const defaultCrs =
      declaredDefault !== undefined && enumerated.includes(declaredDefault)
        ? declaredDefault
        : first;
    return { crs: enumerated, defaultCrs };
  }
  // No enum: bbox.yaml's own default is CRS84, so that is the assumption.
  const only = declaredDefault ?? CRS84;
  return { crs: [only], defaultCrs: only };
}

function isDimension(value: number): value is BboxDimension {
  return value === 4 || value === 6;
}

/** R4: which coordinate counts the `bbox` member allows, 4 and 6 when unstated. */
function readDimensions(properties: JsonObject | undefined): readonly BboxDimension[] {
  const bbox = properties?.["bbox"];
  if (!isJsonObject(bbox)) return [4, 6];

  // bbox.yaml's form: `oneOf: [{minItems: 4, maxItems: 4}, {minItems: 6, maxItems: 6}]`.
  const exact = (readArray(bbox, "oneOf") ?? [])
    .filter(isJsonObject)
    .map((branch) => [readNumber(branch, "minItems"), readNumber(branch, "maxItems")] as const)
    .flatMap(([min, max]) => (min !== undefined && min === max && isDimension(min) ? [min] : []));
  if (exact.length > 0) return [...new Set(exact)].sort((a, b) => a - b);

  const min = readNumber(bbox, "minItems") ?? 0;
  const max = readNumber(bbox, "maxItems") ?? Number.POSITIVE_INFINITY;
  return ([4, 6] as const).filter((count) => count >= min && count <= max);
}

const matchBbox: Matcher = (schema) => {
  const members = membersOf(schema);
  const hinted = members.some((member) => readString(member, "format") === "ogc-bbox");
  const wellKnown = members.some((member) => isBboxSchemaRef(readString(member, "$ref")));
  const shaped = members.find(hasBboxShape);
  if (!hinted && !wellKnown && shaped === undefined) return undefined;

  const properties = members.map((member) => readObject(member, "properties")).find(Boolean);
  return {
    kind: "bbox",
    ...readCrsOptions(properties, wellKnown),
    dimensions: readDimensions(properties),
  };
};

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
// Complex inputs: one value, alternative encodings (T3)

/** What an encoding branch may carry. Anything else is a different kind of `oneOf`. */
const ENCODING_BRANCH_KEYS: ReadonlySet<string> = new Set([
  "type",
  "contentMediaType",
  "contentEncoding",
  "contentSchema",
  "format",
  "title",
  "description",
]);

function encodingLabel(mediaType: string | undefined, encoding: string | undefined): string {
  const shown = encoding !== undefined && !/^utf-?8$/i.test(encoding) ? ` (${encoding})` : "";
  return `${mediaType ?? "text"}${shown}`;
}

function complexFormat(branch: unknown): ComplexFormat | undefined {
  if (!isJsonObject(branch)) return undefined;
  const keys = Object.keys(branch);
  if (keys.length === 1 && branch["type"] === "object")
    return { label: "JSON object", object: true };
  if (!keys.every((key) => ENCODING_BRANCH_KEYS.has(key))) return undefined;
  if ("type" in branch && branch["type"] !== "string") return undefined;

  const mediaType = readString(branch, "contentMediaType");
  const encoding = readString(branch, "contentEncoding");
  if (mediaType === undefined && encoding === undefined) return undefined;
  const contentSchema = readString(branch, "contentSchema");
  return {
    label: encodingLabel(mediaType, encoding),
    object: false,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(encoding === undefined ? {} : { encoding }),
    ...(contentSchema === undefined ? {} : { contentSchema }),
  };
}

/**
 * A `oneOf` whose every branch is an alternative *encoding* of one value — a
 * string with a `contentMediaType` and/or `contentEncoding`, or a bare
 * `type: "object"` — is a complex input, not a general `oneOf`. That is 1 434
 * of ZOO's 1 436 `oneOf`s (Z2); the other two are all-object branches, which
 * this also covers. Any other `oneOf` falls through to the refusal below.
 */
const matchComplex: Matcher = (schema) => {
  const branches = readArray(schema, "oneOf");
  if (branches === undefined || branches.length === 0) return undefined;
  if (["anyOf", "allOf", "not", "$ref"].some((keyword) => keyword in schema)) return undefined;

  const formats: ComplexFormat[] = [];
  for (const branch of branches) {
    const format = complexFormat(branch);
    if (format === undefined) return undefined;
    // ZOO repeats identical branches (GdalExtractProfile offers the same JSON
    // object twice). One choice per distinct encoding.
    const duplicate = formats.some(
      (seen) =>
        seen.object === format.object &&
        seen.mediaType === format.mediaType &&
        seen.encoding === format.encoding,
    );
    if (!duplicate) formats.push(format);
  }
  return { kind: "complex", formats, byReference: true };
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
  ctx.report("unsupported-keyword", reason, found);
  return jsonControl(schema, reason);
};

// ---------------------------------------------------------------------------
// Types

function satisfiesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isJsonObject(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return false;
  }
}

/** R3: `const` is an enum of one, not a free text field. */
const matchConst: Matcher = (schema) =>
  "const" in schema
    ? {
        kind: "select",
        options: [{ value: schema["const"], label: labelFor(schema["const"]) }],
        default: schema["const"],
      }
    : undefined;

const matchEnum: Matcher = (schema, ctx) => {
  const values = readArray(schema, "enum");
  if (values === undefined || values.length === 0) return undefined;

  // N2: 457 of ZOO's SAGA booleans say `type: "boolean"` and list the
  // *strings* "true" and "false". No value satisfies both, so the schema
  // contradicts itself; the declared type wins and the contradiction is kept.
  const types = readTypes(schema);
  const satisfiable = values.some(
    (value) => value === null || types.some((type) => satisfiesType(value, type)),
  );
  if (types.length > 0 && !satisfiable) {
    ctx.report(
      "contradictory-schema",
      `no \`enum\` value is of the declared type \`${types.join(" | ")}\``,
      "enum",
    );
    return undefined;
  }

  // R12: `null` is not an option. The encoder leaves a null out of the request,
  // so picking it would only ever have meant "not set".
  const options: readonly Option[] = values
    .filter((value) => value !== null)
    .map((value) => ({ value, label: labelFor(value) }));
  if (options.length === 0) return undefined;

  return "default" in schema
    ? { kind: "select", options, default: schema["default"] }
    : { kind: "select", options };
};

/**
 * R1: `type: ["string", "number"]` used to match the number matcher, which
 * then refused every string the server accepts. More than one non-null type
 * gets the JSON editor instead, where the user can write either.
 */
const matchMultiType: Matcher = (schema, ctx) => {
  const declared = readTypes(schema);
  const distinct = new Set(
    declared
      .filter((type) => type !== "null")
      .map((type) => (type === "integer" ? "number" : type)),
  );
  if (distinct.size <= 1) return undefined;
  const reason = `no single control for type \`${declared.join(" | ")}\``;
  ctx.report("unsupported-type", reason, "type");
  return jsonControl(schema, reason);
};

const matchBoolean: Matcher = (schema) =>
  readTypes(schema).includes("boolean")
    ? { kind: "checkbox", default: readBoolean(schema, "default") }
    : undefined;

/** R2: both spellings — a number (JSON Schema 2019) and a flag (OpenAPI 3.0). */
function readBound(
  schema: JsonObject,
  inclusiveKey: "minimum" | "maximum",
  exclusiveKey: "exclusiveMinimum" | "exclusiveMaximum",
): { value: number | undefined; exclusive: boolean } {
  const inclusive = readNumber(schema, inclusiveKey);
  const exclusive = schema[exclusiveKey];
  if (typeof exclusive === "number" && Number.isFinite(exclusive)) {
    const tighter =
      inclusive === undefined ||
      (inclusiveKey === "minimum" ? exclusive >= inclusive : exclusive <= inclusive);
    if (tighter) return { value: exclusive, exclusive: true };
    return { value: inclusive, exclusive: false };
  }
  return { value: inclusive, exclusive: exclusive === true && inclusive !== undefined };
}

const matchNumber: Matcher = (schema) => {
  const types = readTypes(schema);
  const numeric = types.includes("number");
  if (!numeric && !types.includes("integer")) return undefined;

  const min = readBound(schema, "minimum", "exclusiveMinimum");
  const max = readBound(schema, "maximum", "exclusiveMaximum");
  return {
    kind: "number",
    integer: !numeric,
    min: min.value,
    max: max.value,
    ...(min.exclusive ? { minExclusive: true } : {}),
    ...(max.exclusive ? { maxExclusive: true } : {}),
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
        ...(readString(schema, "contentMediaType") === undefined ? {} : { multiline: true }),
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
  matchComplex,
  matchUnsupportedKeyword,
  matchConst,
  matchEnum,
  matchMultiType,
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
  ctx.report("unsupported-type", reason, "type");
  return jsonControl(schema, reason);
}
