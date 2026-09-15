import type { JsonSchema } from "@breinstein/oap-client";

/**
 * Narrowing helpers over a process description's input schemas.
 *
 * The core keeps every schema verbatim and types every key `unknown` — it
 * describes itself as "preservative, never interpretive", which leaves the
 * interpreting to us. These are the questions the encoder needs answered, and
 * each returns `undefined` rather than guessing when the schema does not say.
 *
 * Nothing here reads a schema deeply. One level of `oneOf`/`anyOf`/`allOf` is
 * as far as the captured descriptions ever nest the facts we need, and a
 * general resolver would be a JSON Schema implementation rather than a reader.
 */

const COMBINATORS = ["oneOf", "anyOf", "allOf"] as const;

/** Content keywords that mark a schema as describing a complex value. */
const CONTENT_KEYWORDS = ["contentMediaType", "contentEncoding", "contentSchema"] as const;

function asSchema(value: unknown): JsonSchema | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as JsonSchema;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The schema itself, then each of its combinator branches.
 *
 * Servers put the facts we need in either place: ZOO's `echo.c` carries
 * `format: "ogc-bbox"` on the schema, weaver carries it on `oneOf[0]`. Looking
 * in both is what lets one call answer the question for either.
 */
export function schemaBranches(schema: JsonSchema): readonly JsonSchema[] {
  const branches: JsonSchema[] = [schema];

  for (const combinator of COMBINATORS) {
    const value = schema[combinator];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const branch = asSchema(entry);
      if (branch !== undefined) branches.push(branch);
    }
  }

  return branches;
}

/**
 * The schema's own declared `type`.
 *
 * Deliberately not searched across branches: a `oneOf` of a string and an
 * object has no single type, and picking the first would be a coin toss that
 * the coercion rules would then act on.
 */
export function schemaType(schema: JsonSchema): string | undefined {
  return asString(schema["type"]);
}

/** The schema's own `enum`, when it has a usable one. */
export function schemaEnum(schema: JsonSchema): readonly unknown[] | undefined {
  const values = schema["enum"];
  return Array.isArray(values) && values.length > 0 ? values : undefined;
}

/** The `items` schema of an array, from the schema or any branch declaring one. */
export function itemsSchema(schema: JsonSchema): JsonSchema | undefined {
  for (const branch of schemaBranches(schema)) {
    const items = asSchema(branch["items"]);
    if (items !== undefined) return items;
  }
  return undefined;
}

/** True when the schema or any branch declares `format: <format>`. */
export function hasFormat(schema: JsonSchema, format: string): boolean {
  return schemaBranches(schema).some((branch) => asString(branch["format"]) === format);
}

/**
 * Media types the input advertises, deduped, in declaration order.
 *
 * Also reaches into `items`, because a repeated complex input declares its
 * content keywords on the item rather than on the array.
 */
export function declaredMediaTypes(schema: JsonSchema): readonly string[] {
  const found: string[] = [];

  const collect = (candidate: JsonSchema): void => {
    for (const branch of schemaBranches(candidate)) {
      const mediaType = asString(branch["contentMediaType"]);
      if (mediaType !== undefined && !found.includes(mediaType)) found.push(mediaType);
    }
  };

  collect(schema);
  const items = itemsSchema(schema);
  if (items !== undefined) collect(items);

  return found;
}

/**
 * Encodings declared by the branches offering `mediaType`, or by every branch
 * when no media type is named.
 *
 * Compared case-insensitively — one captured description writes `UTF-8` and
 * another `utf-8` for the same thing — but returned exactly as declared, since
 * it is the server's own spelling that goes back on the wire.
 */
export function declaredEncodings(schema: JsonSchema, mediaType?: string): readonly string[] {
  const wanted = mediaType?.toLowerCase();
  const found: string[] = [];

  const collect = (candidate: JsonSchema): void => {
    for (const branch of schemaBranches(candidate)) {
      const encoding = asString(branch["contentEncoding"]);
      if (encoding === undefined) continue;
      if (wanted !== undefined && asString(branch["contentMediaType"])?.toLowerCase() !== wanted) {
        continue;
      }
      if (!found.some((existing) => existing.toLowerCase() === encoding.toLowerCase())) {
        found.push(encoding);
      }
    }
  };

  collect(schema);
  const items = itemsSchema(schema);
  if (items !== undefined) collect(items);

  return found;
}

/**
 * Whether this input carries a payload rather than a plain JSON value.
 *
 * The signal is a content keyword on any branch. It is what separates a string
 * that is a filename or a URL from a string that *is* the data, and it gates
 * both the qualified-value wrapper and the URL-to-reference rule.
 */
export function isComplexSchema(schema: JsonSchema): boolean {
  return schemaBranches(schema).some((branch) =>
    CONTENT_KEYWORDS.some((keyword) => branch[keyword] !== undefined),
  );
}
