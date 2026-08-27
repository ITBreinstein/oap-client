/**
 * Turns filled-in form values into an OGC API - Processes execute request.
 *
 * The inverse of {@link resolveFormPlan}, but not its mirror image: resolving
 * asks "what control does this input need", encoding asks "what does the wire
 * expect", and the two answers diverge. A number arrives from a text field as a
 * string; a repeatable input is one control but a JSON array.
 *
 * It does not validate. A value the server will reject is still encoded and
 * sent, because the server's refusal — read through `classify` — is a better
 * answer than a guess made here, and is the observation the interoperability
 * matrix wants. Nothing in this module throws.
 */

import type { RequestOptions } from "../client.js";
import { isJsonMediaType } from "../http/media-type.js";
import { isJsonArray, isJsonObject } from "./json.js";
import type { Control, FieldPlan, FormPlan } from "./plan.js";

/** Form state, keyed by {@link FieldPlan.id}. */
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

export interface ExecuteOptions {
  /**
   * `"async"` sends `Prefer: respond-async`. Omitted, no Prefer header is sent
   * and the server picks — which servers pick what is worth recording.
   */
  readonly mode?: "sync" | "async" | undefined;
  readonly response?: "raw" | "document" | undefined;
}

export interface ExecuteBody {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly response?: "raw" | "document" | undefined;
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
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
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

function encodeControl(control: Control, value: unknown): unknown {
  // A reference is a property of the value, not of the control — any input can
  // be supplied by href. Except a raw JSON one, whose content is the user's.
  if (control.kind !== "json") {
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
        .map((item) => encodeControl(control.item, item));
    }
    case "text":
    case "select":
    case "geometry":
    case "bbox":
    case "json":
      // A raw JSON field carries whatever the editor produced. Parsing text
      // into JSON belongs in the editor, where the syntax error can be shown.
      return value;
  }
}

/**
 * Wraps a value as `{ value, mediaType }` when the input declares a media type
 * the request body cannot carry natively. JSON — including `application/geo+json`
 * — goes inline, so a geometry stays a geometry rather than a quoted blob.
 */
function qualify(value: unknown, field: FieldPlan): unknown {
  const mediaType = field.mediaType;
  if (mediaType === undefined || isJsonMediaType(mediaType)) return value;
  return { value, mediaType };
}

export function toExecuteBody(
  plan: FormPlan,
  values: FormValues,
  options: ExecuteOptions = {},
): ExecuteBody {
  const inputs: Record<string, unknown> = {};

  for (const field of plan.fields) {
    const supplied = values[field.id];
    if (isAbsent(supplied)) continue;

    const encoded = encodeControl(field.control, supplied);
    // An empty list is the same statement as an absent one.
    if (isJsonArray(encoded) && encoded.length === 0) continue;

    inputs[field.id] = qualify(encoded, field);
  }

  return options.response === undefined ? { inputs } : { inputs, response: options.response };
}

/**
 * The whole request, ready for `client.send(path, …)` — so the headers that
 * decide sync versus async are chosen here, next to the conformance knowledge,
 * rather than assembled by hand in a viewer.
 */
export function toExecuteRequest(
  plan: FormPlan,
  values: FormValues,
  options: ExecuteOptions = {},
): RequestOptions {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.mode === "async") headers["prefer"] = "respond-async";

  return {
    method: "POST",
    headers,
    body: JSON.stringify(toExecuteBody(plan, values, options)),
  };
}
