import type { InputDescription, JsonSchema } from "@breinstein/oap-client";
import {
  declaredEncodings,
  declaredMediaTypes,
  isComplexSchema,
  itemsSchema,
  schemaEnum,
  schemaType,
} from "../schema/facts.js";
import { isBboxInput, toOgcBbox } from "./bbox.js";

/**
 * Form values to the `inputs` object of an execute request.
 *
 * The core declines this job on purpose — `ExecuteInputValue` is `unknown` and
 * the processes layer calls itself "preservative, never interpretive" — so this
 * is where the interpreting happens, and it is the only place in the app that
 * decides bare-versus-qualified, media types and arity.
 *
 * Four of those decisions cannot be read off a process description. Three stop
 * being hard once you ask the *value* rather than the schema: whether it is
 * already a reference, and whether it is an array. The fourth, which media type
 * to name, needs the schema and sometimes an override — which is what
 * {@link InputEncoding} is for, and until a control exists to populate it, a
 * user can author the whole wrapper in the raw JSON editor and rule R3 will
 * pass it through untouched.
 *
 * Nothing here throws, and nothing here refuses to send. A request the server
 * rejects is the evidence this project exists to collect; a request this
 * encoder silently repaired is not.
 */

/** What the flat value bag cannot say and the schema does not determine. */
export interface InputEncoding {
  readonly mediaType?: string;
  readonly encoding?: string;
  /** Send as `{ href }` even when the value does not look like a URL. */
  readonly asReference?: boolean;
  /** Force the `{ value }` wrapper on or off, overriding what the value implies. */
  readonly qualify?: boolean;
}

export type InputEncodings = Readonly<Record<string, InputEncoding>>;

export interface EncodeInputsOptions {
  readonly encodings?: InputEncodings;
}

export interface EncodedInputs {
  /** Ready for `ExecuteOptions.inputs`. */
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Ids left out because the form held nothing for them. */
  readonly omitted: readonly string[];
  /** Things worth saying to the user. Never a reason not to send. */
  readonly notes: readonly string[];
}

const BASE64 = "base64";

const GEOJSON_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

/** R0: absent. `0` and `false` are values; only these three mean "not supplied". */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * R1: the form's `<select>` writes a string whatever the option's real type, so
 * recover the declared member it names.
 *
 * ZOO declares its booleans as `{"type":"boolean","enum":["true","false"]}`,
 * which means the form renders a dropdown and hands back `"true"`. Without this
 * every ZOO boolean would go out as a string.
 */
function recoverEnumMember(value: unknown, schema: JsonSchema): unknown {
  const allowed = schemaEnum(schema);
  if (allowed === undefined || typeof value !== "string") return value;
  return allowed.find((member) => String(member) === value) ?? value;
}

/** R2: a string the schema says is a boolean or a number becomes one. */
function coerceToDeclaredType(value: unknown, schema: JsonSchema): unknown {
  if (typeof value !== "string") return value;
  const type = schemaType(schema);

  if (type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }

  if (type === "number" || type === "integer") {
    const parsed = Number(value.trim());
    return value.trim() !== "" && Number.isFinite(parsed) ? parsed : value;
  }

  return value;
}

function looksLikeUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** R7: the media type to name, and the encoding beside it. */
function chooseMediaType(
  value: unknown,
  schema: JsonSchema,
  override: InputEncoding,
): string | undefined {
  if (override.mediaType !== undefined) return override.mediaType;

  const declared = declaredMediaTypes(schema);
  if (declared.length === 1) return declared[0];

  if (isPlainObject(value) || Array.isArray(value)) {
    // JSON travels as itself. Prefer the GeoJSON media type when the value is
    // GeoJSON and the server admits it, then any JSON-ish declared type.
    const type = isPlainObject(value) ? value["type"] : undefined;
    if (typeof type === "string" && GEOJSON_TYPES.has(type)) {
      const geo = declared.find((media) => media.toLowerCase() === "application/geo+json");
      if (geo !== undefined) return geo;
    }
    const json = declared.find((media) => /\bjson\b/i.test(media));
    if (json !== undefined) return json;
    // One captured request sends an inline FeatureCollection as
    // `application/json` to an input declaring only XML and KML. The server
    // accepted it; the description simply does not describe what it takes.
    if (isComplexSchema(schema)) return "application/json";
  }

  return undefined;
}

function chooseEncoding(
  schema: JsonSchema,
  mediaType: string | undefined,
  override: InputEncoding,
): string | undefined {
  if (override.encoding !== undefined) return override.encoding;

  const declared = declaredEncodings(schema, mediaType);
  if (declared.length === 0) return undefined;

  // Plain text where it is offered; base64 only when it is the only way in.
  const plain = declared.find((encoding) => encoding.toLowerCase() !== BASE64);
  return plain ?? declared[0];
}

function qualify(
  value: unknown,
  mediaType: string | undefined,
  encoding: string | undefined,
): unknown {
  return {
    value,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(encoding === undefined ? {} : { encoding }),
  };
}

/**
 * One value, encoded. `undefined` means "leave this input out" — safe as a
 * sentinel because no encoded value can be `undefined`: JSON has no such thing.
 */
export function encodeInputValue(
  input: InputDescription,
  value: unknown,
  override: InputEncoding = {},
  note: (message: string) => void = () => undefined,
): unknown {
  const schema = input.schema;

  if (isAbsent(value)) return undefined;

  // R3: already authored as a reference or a qualified value — most likely
  // typed straight into the raw JSON editor. Fill only what is missing, so that
  // encoding an encoded value is a fixed point.
  if (isPlainObject(value)) {
    if (typeof value["href"] === "string") {
      const type = value["type"] ?? chooseMediaType(value, schema, override);
      return { ...value, ...(type === undefined ? {} : { type }) };
    }
    if ("value" in value) {
      const mediaType = value["mediaType"] ?? override.mediaType;
      const encoding = value["encoding"] ?? override.encoding;
      return {
        ...value,
        ...(mediaType === undefined ? {} : { mediaType }),
        ...(encoding === undefined ? {} : { encoding }),
      };
    }
  }

  // R5: a bounding box is `{ bbox, crs }` and is never wrapped in `value`.
  if (isBboxInput(schema)) {
    const bbox = toOgcBbox(value, schema);
    if (bbox !== undefined) return bbox;
    note(
      `"${input.id}" is a bounding box, but no box could be read from what the form holds — ` +
        "sending it unchanged.",
    );
  }

  // R4: a URL typed into a complex input means "fetch it from there". The
  // complexity guard keeps an ordinary string that happens to be a URI a string.
  if (
    typeof value === "string" &&
    isComplexSchema(schema) &&
    (override.asReference === true || looksLikeUrl(value))
  ) {
    const type = chooseMediaType(value, schema, override);
    return { href: value, ...(type === undefined ? {} : { type }) };
  }

  // R6: arrays. Send exactly the arity the form holds — never build an array
  // from a single value, never unwrap one. `checkArity` reports a disagreement
  // with the description, and the server's answer settles it.
  if (Array.isArray(value)) {
    // `Array.isArray` narrows `unknown` to `any[]`; naming it keeps the entries
    // unknown, which is what they are.
    const entries: readonly unknown[] = value;
    const items = itemsSchema(schema);
    const itemType = items === undefined ? undefined : schemaType(items);
    const primitiveItems =
      items === undefined || ["string", "number", "integer", "boolean"].includes(itemType ?? "");

    if (schemaType(schema) === "array" && primitiveItems) {
      // A semantic array: one answer that happens to be a list.
      return entries.map((entry) =>
        items === undefined ? entry : coerceToDeclaredType(recoverEnumMember(entry, items), items),
      );
    }

    // Repeated occurrences: each keeps its own wrapper.
    const encoded = entries
      .map((entry) => encodeInputValue(input, entry, override, note))
      .filter((entry) => entry !== undefined);
    return encoded.length === 0 ? undefined : encoded;
  }

  const recovered = coerceToDeclaredType(recoverEnumMember(value, schema), schema);

  // R8: qualification.
  if (override.qualify === false) return recovered;

  const complex = isComplexSchema(schema);
  const mediaType = chooseMediaType(recovered, schema, override);
  const encoding = chooseEncoding(schema, mediaType, override);

  if (override.qualify === true) return qualify(recovered, mediaType, encoding);
  if (isPlainObject(recovered)) return qualify(recovered, mediaType, encoding);
  if (typeof recovered === "string" && complex && mediaType !== undefined) {
    return qualify(recovered, mediaType, encoding);
  }

  return recovered;
}

/** Every input the form holds a value for, encoded. */
export function encodeInputs(
  inputs: readonly InputDescription[],
  values: Readonly<Record<string, unknown>>,
  options: EncodeInputsOptions = {},
): EncodedInputs {
  const encoded: Record<string, unknown> = {};
  const omitted: string[] = [];
  const notes: string[] = [];
  const note = (message: string): void => {
    notes.push(message);
  };

  for (const input of inputs) {
    const result = encodeInputValue(input, values[input.id], options.encodings?.[input.id], note);
    if (result === undefined) omitted.push(input.id);
    else encoded[input.id] = result;
  }

  // Values the form holds for ids the description does not declare are kept,
  // not dropped: `checkArity` reports them, and a server that accepts an
  // undeclared input is worth knowing about.
  for (const [id, value] of Object.entries(values)) {
    if (id in encoded || omitted.includes(id) || isAbsent(value)) continue;
    encoded[id] = value;
    note(`"${id}" is not declared by this process, and is being sent unchanged.`);
  }

  return { inputs: encoded, omitted, notes };
}
