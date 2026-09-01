/**
 * A process description document → a {@link ProcessDescription}.
 *
 * The single most important document in the product: the generated form, the
 * draw tool, the execute request body and the result renderers all come from
 * here. Which is exactly why this module *interprets nothing*.
 *
 * The one rule that outranks everything else in this file: **the `schema` value
 * handed out is deep-equal to the `schema` value received.** No key filtering,
 * no defaulting, no normalising, no rewriting of `$ref` into an absolute URL,
 * no dereferencing. The form generator identifies a bounding-box input by
 * inspecting the schema — against ZOO that is `format: "ogc-bbox"` on a
 * `type: "object"` with `properties.bbox` and `properties.crs` — and this layer
 * cannot know today which key will carry the signal on the next server. So it
 * preserves all of them. There is a test pinning it, and it is one of the three
 * reduction tests.
 *
 * `$ref` is passed through and counted, never followed. Following it means a
 * second HTTP request, to a third-party host, for a document that may be YAML
 * rather than JSON, from a browser that will be blocked by CORS — three new
 * failure modes in the middle of form generation in exchange for a nicer form.
 * "Process X's inputs could not be rendered because the schema is an external
 * `$ref`" is a catalogued finding, not a defect.
 */

import type { ObservationSink } from "../observations.js";
import {
  createReport,
  isRecord,
  KNOWN_DESCRIPTION_KEYS,
  noteUnrecognisedKeys,
  optionalString,
  parseCommon,
  stringArray,
  type ParseReport,
} from "./parse-summary.js";
import { normaliseCardinality } from "./cardinality.js";
import type {
  InputDescription,
  JsonSchema,
  OutputDescription,
  ProcessDescription,
  SchemaShapeCensus,
} from "./types.js";

/** The members of an input or output object this layer models. */
const KNOWN_IO_KEYS: readonly string[] = [
  "title",
  "description",
  "keywords",
  "schema",
  "minOccurs",
  "maxOccurs",
];

/**
 * The schema of an input that declared none.
 *
 * Frozen and shared: it is empty, immutable and indistinguishable per input, so
 * one instance is enough — and freezing it means a caller that treats it as
 * scratch space fails loudly rather than poisoning every other input.
 */
const EMPTY_SCHEMA: JsonSchema = Object.freeze({});

/** Mutable while parsing one document, handed out frozen as a {@link SchemaShapeCensus}. */
interface CensusCounters {
  total: number;
  inlineType: number;
  enumerated: number;
  ref: number;
  composed: number;
  contentMediaType: number;
  formatted: number;
  absent: number;
}

function emptyCounters(): CensusCounters {
  return {
    total: 0,
    inlineType: 0,
    enumerated: 0,
    ref: 0,
    composed: 0,
    contentMediaType: 0,
    formatted: 0,
    absent: 0,
  };
}

/**
 * Count the shapes of one schema. Top level only, deliberately.
 *
 * Recursing would produce a prettier census and a slower, unbounded walk over a
 * document we do not control — and the question the catalogue actually asks is
 * "what does the form generator see when it first looks at this input", which
 * is a top-level question. ZOO's `contentMediaType` living one level down
 * inside a `oneOf` branch is itself the finding, and `composed` records it.
 */
function census(schema: JsonSchema | undefined, counters: CensusCounters): void {
  counters.total += 1;
  if (schema === undefined) {
    counters.absent += 1;
    return;
  }
  if ("type" in schema) counters.inlineType += 1;
  if ("enum" in schema) counters.enumerated += 1;
  if ("$ref" in schema) counters.ref += 1;
  if ("oneOf" in schema || "allOf" in schema || "anyOf" in schema) counters.composed += 1;
  if ("contentMediaType" in schema) counters.contentMediaType += 1;
  if ("format" in schema) counters.formatted += 1;
}

/**
 * The `schema` member, verbatim, or `undefined` if there is not one to hand out.
 *
 * `isRecord` is the *only* thing that happens to this value. It is a genuine
 * runtime check — a type predicate, not a cast — and `JsonSchema` is defined as
 * an open index signature precisely so that what the check proves and what the
 * type claims are the same statement.
 */
function readSchema(value: unknown, report: ParseReport, what: string): JsonSchema | undefined {
  if (value === undefined) {
    report.warnings.push(`${what}-schema-absent`);
    return undefined;
  }
  if (!isRecord(value)) {
    report.warnings.push(`${what}-schema-is-not-an-object`);
    return undefined;
  }
  return value;
}

/**
 * The wire shape is an object keyed by id; we fold the key in and hand back an
 * array. A form renders by iterating in a stable order, and JavaScript object
 * key order is only guaranteed for keys that do *not* look like integers — an
 * input id of `"1"` would silently jump to the front of the form.
 *
 * A member whose value is not an object is skipped and recorded, rather than
 * throwing: one unusable input out of eleven must not cost the other ten.
 */
function entriesOf(
  value: unknown,
  report: ParseReport,
  what: "inputs" | "outputs",
): readonly (readonly [string, Record<string, unknown>])[] {
  if (value === undefined) {
    report.warnings.push(`${what}-absent`);
    return [];
  }
  if (!isRecord(value)) {
    report.warnings.push(`${what}-is-not-an-object`);
    return [];
  }

  const entries: (readonly [string, Record<string, unknown>])[] = [];
  for (const [id, member] of Object.entries(value)) {
    if (!isRecord(member)) {
      report.warnings.push(`${what}:${id}:not-an-object`);
      continue;
    }
    entries.push([id, member]);
  }
  return entries;
}

function parseInput(
  id: string,
  member: Record<string, unknown>,
  report: ParseReport,
  counters: CensusCounters,
): InputDescription {
  noteUnrecognisedKeys(report, member, KNOWN_IO_KEYS);

  const { cardinality, warnings } = normaliseCardinality(member["minOccurs"], member["maxOccurs"]);
  for (const warning of warnings) report.warnings.push(`inputs:${id}:${warning}`);

  const schema = readSchema(member["schema"], report, `inputs:${id}`);
  census(schema, counters);

  const title = optionalString(member["title"]);
  const description = optionalString(member["description"]);
  const keywords = stringArray(member["keywords"], report, `inputs:${id}:keywords`);

  return {
    id,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(keywords === undefined ? {} : { keywords }),
    minOccurs: cardinality.minOccurs,
    maxOccurs: cardinality.maxOccurs,
    required: cardinality.required,
    multiple: cardinality.multiple,
    schema: schema ?? EMPTY_SCHEMA,
  };
}

function parseOutput(
  id: string,
  member: Record<string, unknown>,
  report: ParseReport,
): OutputDescription {
  // `minOccurs`/`maxOccurs` are not part of an output, so the shared key list
  // would report them as unrecognised if a server sent them — which is right.
  noteUnrecognisedKeys(report, member, ["title", "description", "keywords", "schema"]);

  const schema = readSchema(member["schema"], report, `outputs:${id}`);
  const title = optionalString(member["title"]);
  const description = optionalString(member["description"]);
  const keywords = stringArray(member["keywords"], report, `outputs:${id}:keywords`);

  return {
    id,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(keywords === undefined ? {} : { keywords }),
    schema: schema ?? EMPTY_SCHEMA,
  };
}

export interface ParsedDescription {
  readonly process: ProcessDescription;
  readonly report: ParseReport;
  readonly census: SchemaShapeCensus;
}

export interface ParseDescriptionOptions {
  /** The URL the document was *served* from. Every href resolves against it. */
  readonly documentUrl: string;
  /** What the caller asked for, so a mismatch can be reported against it. */
  readonly requestedId?: string | undefined;
  readonly sink?: ObservationSink | undefined;
}

/**
 * Parse a whole process description document.
 *
 * Throws only for the fatal cases: not a JSON object, no `id`, `id` not a
 * string. Everything else degrades into `report.warnings`.
 */
export function parseDescription(
  body: unknown,
  options: ParseDescriptionOptions,
): ParsedDescription {
  const report = createReport();
  const counters = emptyCounters();

  const { summary, record } = parseCommon(body, {
    documentUrl: options.documentUrl,
    where: "process description",
    report,
    ...(options.sink === undefined ? {} : { sink: options.sink }),
  });

  noteUnrecognisedKeys(report, record, KNOWN_DESCRIPTION_KEYS);

  // A server that answers `/processes/a` with a description of `b` has done
  // something worth knowing about — but it has still handed us a usable
  // document, so this degrades rather than throwing.
  if (options.requestedId !== undefined && summary.id !== options.requestedId) {
    report.warnings.push("id-does-not-match-the-requested-process");
  }

  const inputs = entriesOf(record["inputs"], report, "inputs").map(([id, member]) =>
    parseInput(id, member, report, counters),
  );
  const outputs = entriesOf(record["outputs"], report, "outputs").map(([id, member]) =>
    parseOutput(id, member, report),
  );

  return {
    process: { ...summary, inputs, outputs },
    report,
    census: { ...counters },
  };
}
