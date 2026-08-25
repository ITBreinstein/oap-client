/**
 * Reading helpers for JSON that arrived over the wire.
 *
 * A process description is whatever the server sent, not what the spec says it
 * should have sent. Every accessor here returns `undefined` rather than
 * throwing, so a malformed fragment degrades to the JSON fallback instead of
 * failing the whole form.
 */

/** A JSON object with known keys and unverified value types. */
export type JsonObject = { readonly [key: string]: unknown };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function readString(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

export function readNumber(source: JsonObject, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(source: JsonObject, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readArray(source: JsonObject, key: string): readonly unknown[] | undefined {
  const value = source[key];
  return isJsonArray(value) ? value : undefined;
}

export function readObject(source: JsonObject, key: string): JsonObject | undefined {
  const value = source[key];
  return isJsonObject(value) ? value : undefined;
}

/** JSON Schema allows `type` to be a string or an array of strings. */
export function readTypes(schema: JsonObject): readonly string[] {
  const value = schema["type"];
  if (typeof value === "string") return [value];
  if (isJsonArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}
