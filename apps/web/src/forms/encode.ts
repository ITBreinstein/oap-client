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

import { classifyCrs } from "./crs.js";
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
 * value, so the encoder only parses it; the validator is what refuses bad JSON.
 */
export interface RawJson {
  readonly rawJson: string;
}

export function isRawJson(value: unknown): value is RawJson {
  return isJsonObject(value) && typeof value["rawJson"] === "string";
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
  if (isComplexValue(value)) {
    return (value.value ?? "") === "" && (value.href ?? "").trim() === "";
  }
  if (isBboxValue(value)) return value.coordinates.length === 0;
  return false;
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

/** Leaves anything unparseable alone: the server's rejection says more than a guess. */
function coerceNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(parsed) ? parsed : value;
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
function parseRaw(raw: RawJson): unknown {
  try {
    const parsed: unknown = JSON.parse(raw.rawJson);
    return parsed;
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
  // A bare array is four numbers in the default CRS: what a caller without a
  // CRS picker would hand over.
  const box: BboxValue | undefined = isBboxValue(value)
    ? value
    : isJsonArray(value) && value.every((entry) => typeof entry === "number")
      ? { coordinates: value, crs: control.defaultCrs }
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

function encodeComplex(control: ComplexControl, value: unknown): unknown {
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
    return { value: parseRaw({ rawJson: value.value ?? "" }) };
  }
  // R7: the chosen branch's media type and encoding, which the prototype could
  // not see because it only looked at a top-level `contentMediaType`.
  return {
    value: value.value ?? "",
    ...(format.mediaType === undefined ? {} : { mediaType: format.mediaType }),
    ...(format.encoding === undefined ? {} : { encoding: format.encoding }),
  };
}

function encodeControl(
  control: Control,
  value: unknown,
  note: (code: EncodeNote["code"], crs: string) => void,
): unknown {
  // A raw JSON value, wherever it appears, is the user's own wire value.
  if (isRawJson(value)) return parseRaw(value);

  // A reference is a property of the value, not of the control — any input can
  // be supplied by href. Except a raw JSON one, whose content is the user's.
  if (control.kind !== "json" && control.kind !== "complex") {
    const reference = asByReference(value);
    if (reference !== undefined) return reference;
  }

  switch (control.kind) {
    case "number":
      return coerceNumber(value);
    case "checkbox":
      return coerceBoolean(value);
    case "list": {
      // A lone value for a repeatable input is a list of one, not an error.
      const items = isJsonArray(value) ? value : [value];
      return items
        .filter((item) => !isAbsent(item))
        .map((item) => encodeControl(control.item, item, note));
    }
    case "bbox":
      return encodeBbox(control, value, note);
    case "complex":
      return encodeComplex(control, value);
    case "geometry":
      // Accepted limitation (N4): a geometry object is passed through bare,
      // although `inputValueNoObject` admits no bare object and 1.0 wants
      // `{ "value": … }`. Drawing geometries is out of scope for this task —
      // the renderer shows a raw JSON editor, where the user writes the wire
      // value — and the right wrapping is decided when drawing lands.
      return value;
    case "text":
    case "select":
    case "json":
      return value;
  }
}

export function toExecuteBody(plan: FormPlan, values: FormValues): ExecuteBody {
  const entries: [string, unknown][] = [];
  const notes: EncodeNote[] = [];

  for (const field of plan.fields) {
    // N5: a bare `values[id]` reads Object.prototype for an id like
    // "constructor", and would send it.
    const supplied = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
    if (isAbsent(supplied)) continue;

    const encoded = encodeControl(field.control, supplied, (code, crs) => {
      notes.push({ inputId: field.id, code, crs });
    });
    // An empty list is the same statement as an absent one.
    if (isJsonArray(encoded) && encoded.length === 0) continue;

    entries.push([field.id, encoded]);
  }

  // N5: `fromEntries` defines own properties, so an input called "__proto__"
  // is sent rather than silently becoming the object's prototype.
  return { inputs: Object.fromEntries(entries), notes };
}
