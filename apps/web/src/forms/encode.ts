/**
 * Turns filled-in form values into the `inputs` of an execute request.
 *
 * The inverse of {@link resolveFormPlan}, but not its mirror image: resolving
 * asks "what control does this input need", encoding asks "what does the wire
 * expect", and the two answers diverge. A number arrives from a text field as a
 * string; a repeatable input is one control but a JSON array; a bounding box is
 * four numbers on the map and `{ "bbox": […], "crs": "…" }` on the wire.
 *
 * Only `inputs`. The request itself — headers, `outputs`, `response`, the URL —
 * is the core's `execute()`, which already builds it (the prototype's
 * `toExecuteRequest` and its `ExecuteOptions` duplicated that and are gone).
 *
 * It does not validate. A value the server will reject is still encoded and
 * sent, because the server's refusal is a better answer than a guess made here;
 * the cheap checks the plan does state live in `validate.ts`, and run before
 * this. Nothing in this module throws.
 */

import { classifyCrs, typedBboxCrs } from "./crs.js";
import { isJsonNumber, parseExact } from "./exact-json.js";
import { isJsonArray, isJsonObject } from "./json.js";
import type { BboxControl, ComplexControl, Control, FormPlan } from "./plan.js";

/** Form state, keyed by field id. Read with `Object.hasOwn`, never by bare lookup (N5). */
export type FormValues = Readonly<Record<string, unknown>>;

/**
 * A value the server should fetch itself rather than receive inline. Recognised
 * structurally on any field except a raw JSON one, where a user-authored object
 * with an `href` key means whatever the user meant by it.
 */
export interface ByReference {
  readonly href: string;
  readonly type?: string | undefined;
}

/**
 * A bounding-box field's value: west, south, east, north (and heights, for six
 * numbers) in *longitude-first* order whatever the CRS, as the map binding and
 * the typed fields both produce it — plus the CRS the user chose. The encoder
 * owns the wire order (R6); nothing upstream of it needs to know about axes.
 */
export interface BboxValue {
  readonly coordinates: readonly number[];
  readonly crs: string;
}

/** A complex field's value: which format, then inline text or a URL. */
export interface ComplexValue {
  /** Index into {@link ComplexControl.formats}. */
  readonly format: number;
  /** Inline: the text, JSON text for an object format, base64 for a base64 one. */
  readonly value?: string | undefined;
  /** By reference: sent as `{ "href": …, "type": … }` when non-empty. */
  readonly href?: string | undefined;
}

/**
 * What the raw JSON editor holds: the text as typed. The user authors the wire
 * value, so the encoder only parses it, keeping its numbers as written
 * (`exact-json.ts`); the validator is what refuses bad JSON.
 */
export interface RawJson {
  readonly rawJson: string;
}

export function isRawJson(value: unknown): value is RawJson {
  return isJsonObject(value) && typeof value["rawJson"] === "string";
}

/** GeoJSON's registered media type (RFC 7946 §12). */
export const GEOJSON_MEDIA_TYPE = "application/geo+json";

/**
 * A hint for the raw JSON editor, which sends exactly what was typed: said
 * when the text is a JSON object that is none of the wrappers the standard
 * gives an input — a qualified value, a reference, or a bounding box. Never
 * a refusal: the editor is the escape hatch, and the server's answer is the
 * test. Undefined when there is nothing to say, including for text that does
 * not parse, which the validator reports.
 */
export function bareObjectHint(raw: RawJson): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.rawJson);
  } catch {
    return undefined;
  }
  if (!isJsonObject(parsed)) return undefined;
  if (["value", "href", "bbox"].some((key) => Object.hasOwn(parsed, key))) return undefined;
  return 'This is a bare JSON object, and it will be sent as typed. OGC API - Processes 1.0 expects an object input wrapped as { "value": … }, or given by reference as { "href": … }.';
}

/**
 * What a geometry field holds: GeoJSON text, drawn on the map, loaded from a
 * file or typed. Unlike {@link RawJson} it is the value, not the wire value —
 * the encoder wraps it.
 */
export interface GeoJsonText {
  readonly geojson: string;
}

export function isGeoJsonText(value: unknown): value is GeoJsonText {
  return isJsonObject(value) && typeof value["geojson"] === "string";
}

/**
 * Something the encoder changed on the way to the wire and the caller must
 * record (T4, T9). Carries a CRS URI, never a coordinate.
 */
export interface EncodeNote {
  readonly inputId: string;
  readonly code: "bbox-axis-swapped";
  readonly crs: string;
}

export interface ExecuteBody {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly notes: readonly EncodeNote[];
}

export interface EncodeOptions {
  /**
   * Keep each number in JSON text as written (W28), where a double would
   * change it: the default, for the request. `false` reads every number as
   * JavaScript holds it, for a caller that compares values rather than sending
   * them, as the schema warnings do.
   */
  readonly exact?: boolean;
}

/** How one request is being encoded. */
interface Encoding {
  readonly note: (code: EncodeNote["code"], crs: string) => void;
  readonly parse: (text: string) => unknown;
}

/**
 * Values treated as "not supplied" and left out of the request entirely.
 *
 * The empty string is in here because an untouched text input is `""` in every
 * form library there is, and sending that for each optional field a process
 * declares is how you get a validation error the user cannot explain. The cost
 * is that a deliberate empty string cannot be sent; if a server ever needs one,
 * that is a finding rather than a special case.
 */
export function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (isRawJson(value)) return value.rawJson.trim() === "";
  if (isGeoJsonText(value)) return value.geojson.trim() === "";
  if (isComplexValue(value)) {
    return (value.value ?? "") === "" && (value.href ?? "").trim() === "";
  }
  if (isBboxValue(value)) return value.coordinates.length === 0;
  return false;
}

/**
 * {@link isAbsent}, for a value held by `control`. A number field holding only
 * spaces is blank too (W27): read as a number it was 0, so it passed the
 * checks, and it was sent as the string " ". A text field's spaces are text.
 */
export function isAbsentFor(control: Control, value: unknown): boolean {
  if (control.kind === "number" && typeof value === "string") return value.trim() === "";
  return isAbsent(value);
}

function isComplexValue(value: unknown): value is ComplexValue {
  return isJsonObject(value) && typeof value["format"] === "number";
}

function isBboxValue(value: unknown): value is BboxValue {
  return (
    isJsonObject(value) &&
    typeof value["crs"] === "string" &&
    isJsonArray(value["coordinates"]) &&
    value["coordinates"].every((entry) => typeof entry === "number")
  );
}

/**
 * Leaves anything unparseable alone: the server's rejection says more than a
 * guess. Text in JSON's number grammar is read like JSON text (W28), so a
 * number a double would change — a 19-digit identifier — is sent as typed.
 */
function coerceNumber(value: unknown, parse: Encoding["parse"]): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  const parsed = Number(text);
  if (text === "" || !Number.isFinite(parsed)) return value;
  return isJsonNumber(text) ? parse(text) : parsed;
}

function coerceBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function asByReference(value: unknown): ByReference | undefined {
  if (!isJsonObject(value)) return undefined;
  const href = value["href"];
  if (typeof href !== "string") return undefined;
  const type = value["type"];
  return typeof type === "string" ? { href, type } : { href };
}

/** Parses, or hands the text back unchanged for the server to refuse. */
function parseRaw(raw: RawJson, parse: Encoding["parse"]): unknown {
  try {
    return parse(raw.rawJson);
  } catch {
    return raw.rawJson;
  }
}

/** Longitude-first to latitude-first: west,south,east,north → south,west,north,east. */
function swapAxes(coordinates: readonly number[]): readonly number[] {
  const at = (index: number): number => coordinates[index] ?? Number.NaN;
  return coordinates.length === 6
    ? [at(1), at(0), at(2), at(4), at(3), at(5)]
    : [at(1), at(0), at(3), at(2)];
}

function encodeBbox(
  control: BboxControl,
  value: unknown,
  note: (code: EncodeNote["code"], crs: string) => void,
): unknown {
  // A bare array is four numbers in the CRS a typed box starts in: what a
  // caller without a CRS picker would hand over.
  const box: BboxValue | undefined = isBboxValue(value)
    ? value
    : isJsonArray(value) && value.every((entry) => typeof entry === "number")
      ? { coordinates: value, crs: typedBboxCrs(control) }
      : undefined;
  if (box === undefined) return value;

  // T9. The map and the typed fields are both longitude-first. EPSG:4326 is
  // latitude-first, and a server that lists only it (ZOO's echo does) would
  // otherwise receive a box on the other side of the planet. ZOO also relabels
  // whatever CRS it is sent as its own default (finding 0051), so sending
  // CRS84 unswapped to it is not a way out.
  if (classifyCrs(box.crs) === "epsg4326") {
    note("bbox-axis-swapped", box.crs);
    return { bbox: swapAxes(box.coordinates), crs: box.crs };
  }
  // The CRS is always sent, even when it is the default: ZOO's bbox schema
  // lists `crs` as required, and an explicit CRS cannot be misread.
  return { bbox: box.coordinates, crs: box.crs };
}

function encodeComplex(control: ComplexControl, value: unknown, parse: Encoding["parse"]): unknown {
  if (!isComplexValue(value)) return value;
  const format = control.formats[value.format] ?? control.formats[0];
  if (format === undefined) return value.value;

  const href = (value.href ?? "").trim();
  if (href !== "") {
    const type = format.mediaType ?? (format.object ? "application/json" : undefined);
    return type === undefined ? { href } : { href, type };
  }

  if (format.object) {
    // `inputValueNoObject` admits no bare object, so a JSON object travels as
    // `{ "value": … }` — the standard's own example does exactly this, and ZOO
    // answers a bare one with a 500 (echo-complex-bare-object-500.http).
    return { value: parseRaw({ rawJson: value.value ?? "" }, parse) };
  }
  // R7: the chosen branch's media type and encoding, which the prototype could
  // not see because it only looked at a top-level `contentMediaType`.
  return {
    value: value.value ?? "",
    ...(format.mediaType === undefined ? {} : { mediaType: format.mediaType }),
    ...(format.encoding === undefined ? {} : { encoding: format.encoding }),
  };
}

function encodeControl(control: Control, value: unknown, how: Encoding): unknown {
  // A raw JSON value, wherever it appears, is the user's own wire value.
  if (isRawJson(value)) return parseRaw(value, how.parse);

  // A reference is a property of the value, not of the control — any input can
  // be supplied by href. Except a raw JSON one, whose content is the user's.
  if (control.kind !== "json" && control.kind !== "complex") {
    const reference = asByReference(value);
    if (reference !== undefined) return reference;
  }

  switch (control.kind) {
    case "number":
      return coerceNumber(value, how.parse);
    case "checkbox":
      return coerceBoolean(value);
    case "list": {
      // A lone value for a repeatable input is a list of one, not an error.
      const items = isJsonArray(value) ? value : [value];
      return items
        .filter((item) => !isAbsentFor(control.item, item))
        .map((item) => encodeControl(control.item, item, how));
    }
    case "bbox":
      return encodeBbox(control, value, how.note);
    case "complex":
      return encodeComplex(control, value, how.parse);
    case "geometry": {
      // Requirement 20: `inputValueNoObject` admits no bare object, so GeoJSON
      // travels as `{ "value": … }`, as a complex input's JSON object does.
      // This ends accepted limitation N4, which sent it bare while geometry
      // could only be typed as the wire value. pygeoapi hands the wrapper to
      // the process unopened (finding 0052); that is the server's to fix.
      //
      // A geometry control exists only where the description said GeoJSON — a
      // `geojson-*` format, a `$ref` to a GeoJSON schema, or
      // `contentMediaType: application/geo+json` (`matchers.ts`) — so the
      // qualified value says so too: stating the format is what a qualified
      // value is for. A complex input's bare `type: "object"` branch says
      // nothing of the kind, and gets no media type.
      const geojson = isGeoJsonText(value)
        ? parseRaw({ rawJson: value.geojson }, how.parse)
        : value;
      return isJsonObject(geojson) ? { value: geojson, mediaType: GEOJSON_MEDIA_TYPE } : geojson;
    }
    case "text":
    case "select":
    case "json":
      return value;
  }
}

export function toExecuteBody(
  plan: FormPlan,
  values: FormValues,
  options: EncodeOptions = {},
): ExecuteBody {
  const entries: [string, unknown][] = [];
  const notes: EncodeNote[] = [];
  const parse = options.exact === false ? (text: string): unknown => JSON.parse(text) : parseExact;

  for (const field of plan.fields) {
    // N5: a bare `values[id]` reads Object.prototype for an id like
    // "constructor", and would send it.
    const supplied = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
    if (isAbsentFor(field.control, supplied)) continue;

    const encoded = encodeControl(field.control, supplied, {
      note: (code, crs) => {
        notes.push({ inputId: field.id, code, crs });
      },
      parse,
    });
    // An empty list is the same statement as an absent one.
    if (isJsonArray(encoded) && encoded.length === 0) continue;

    entries.push([field.id, encoded]);
  }

  // N5: `fromEntries` defines own properties, so an input called "__proto__"
  // is sent rather than silently becoming the object's prototype.
  return { inputs: Object.fromEntries(entries), notes };
}
