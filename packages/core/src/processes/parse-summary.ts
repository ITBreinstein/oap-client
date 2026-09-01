/**
 * One entry of the `processes` array → a {@link ProcessSummary}.
 *
 * Also the home of the shape helpers the description parser reuses, and of the
 * `jobControlOptions` derivation.
 *
 * The tolerance policy, applied identically here and in `parse-description.ts`:
 *
 * - **Fatal:** the entry is not an object, or has no `id`, or its `id` is not a
 *   string. Nothing downstream can address a process without an id, so there is
 *   no degraded form to offer.
 * - **Degrade and record:** everything else. A missing `version` — which the
 *   OGC schema marks required and servers routinely omit — a `keywords` value
 *   that is a bare string, an absent `jobControlOptions`. Each yields a usable
 *   object plus a warning code on the observation.
 *
 * Unrecognised members are kept *nowhere* but their names are recorded. That
 * gives a cheap early-warning signal for v2 draft fields and vendor extensions
 * without giving any caller a way to reach around the typed API into the raw
 * document — the same reasoning that kept the landing-page body out of
 * `inspect()`'s return value.
 */

import { MalformedProcessDocumentError } from "../errors.js";
import { resolveBodyLinks } from "../links/resolve.js";
import { readBodyLinks } from "../links/resolve.js";
import type { Link } from "../links/types.js";
import type { ObservationSink } from "../observations.js";
import type { ProcessExecutionOptions, ProcessSummary } from "./types.js";

/**
 * The members this layer models. Anything else in a process object is reported
 * by name and dropped.
 *
 * Both reference servers exercise this. ZOO sends `mutable` and `metadata`
 * (OGC Part 2 and the Common metadata array); pygeoapi sends `example`. All
 * three are real, none is modelled here, and all three should show up in the
 * matrix rather than vanish.
 */
const KNOWN_SUMMARY_KEYS: readonly string[] = [
  "id",
  "title",
  "description",
  "version",
  "keywords",
  "jobControlOptions",
  "outputTransmission",
  "links",
];

/** Additionally recognised on a full description. */
const KNOWN_DESCRIPTION_KEYS: readonly string[] = [...KNOWN_SUMMARY_KEYS, "inputs", "outputs"];

export { KNOWN_DESCRIPTION_KEYS, KNOWN_SUMMARY_KEYS };

/**
 * `typeof null === "object"` in JavaScript, which is why the explicit `!== null`
 * is here. A *type predicate* rather than a cast: inside `if (isRecord(body))`
 * TypeScript narrows `body` from `unknown` to a readable object, and it is
 * entitled to because the function actually performed the check.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Present, a string, not blank. Absent optional members stay absent. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * What the parsers accumulate as they degrade.
 *
 * Mutable on purpose and never exposed: the operation drains it into one
 * observation and hands the caller the parsed object only.
 */
export interface ParseReport {
  readonly warnings: string[];
  readonly unrecognisedKeys: Set<string>;
}

export function createReport(): ParseReport {
  return { warnings: [], unrecognisedKeys: new Set<string>() };
}

/** Record every member of `value` that this layer does not model. */
export function noteUnrecognisedKeys(
  report: ParseReport,
  value: Record<string, unknown>,
  known: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) report.unrecognisedKeys.add(key);
  }
}

/**
 * An array of strings, tolerating the two ways servers get it wrong: sending a
 * bare string instead of an array, and mixing non-strings into the array.
 *
 * Returns `undefined` only when the member is absent, so the caller can tell
 * "not declared" from "declared empty".
 */
export function stringArray(
  value: unknown,
  report: ParseReport,
  what: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;

  if (typeof value === "string") {
    report.warnings.push(`${what}-is-a-string-not-an-array`);
    return [value];
  }

  if (!Array.isArray(value)) {
    report.warnings.push(`${what}-is-not-an-array`);
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  if (strings.length !== value.length) report.warnings.push(`${what}-has-non-string-entries`);
  return strings;
}

/**
 * The OGC default when a server declares nothing: synchronous execution only.
 *
 * 18-062r2 §7.10: `jobControlOptions` defaults to `["sync-execute"]`. Getting
 * this backwards would have the UI offer an async button against a server that
 * cannot honour it.
 */
export const SYNC_EXECUTE = "sync-execute";
export const ASYNC_EXECUTE = "async-execute";
export const DISMISS = "dismiss";

/**
 * `jobControlOptions` → three booleans plus the evidence.
 *
 * `defaulted` is the whole point of the shape. Against ZOO all 703 processes
 * declare all three options, and against pygeoapi 0.21.0 `hello-world` declares
 * sync and async but not dismiss — so on both servers `defaulted` is `false`
 * and the booleans are the server's own words. A third server that declares
 * nothing produces the same `sync: true` with `defaulted: true`, and the matrix
 * must not read those two as the same statement.
 */
export function deriveExecution(value: unknown, report: ParseReport): ProcessExecutionOptions {
  const declared = stringArray(value, report, "job-control-options");
  const DEFAULTED: ProcessExecutionOptions = {
    sync: true,
    async: false,
    dismiss: false,
    declared: [],
    defaulted: true,
  };

  if (declared === undefined) {
    // `stringArray` has already warned when the member was present but unusable.
    if (value === undefined) report.warnings.push("job-control-options-absent");
    return DEFAULTED;
  }

  if (declared.length === 0) {
    report.warnings.push("job-control-options-declared-empty");
    return DEFAULTED;
  }

  return {
    sync: declared.includes(SYNC_EXECUTE),
    async: declared.includes(ASYNC_EXECUTE),
    dismiss: declared.includes(DISMISS),
    declared,
    defaulted: false,
  };
}

/** Only a missing or non-string `id` is fatal, and the message says where. */
function requireId(entry: Record<string, unknown>, documentUrl: string, where: string): string {
  const id: unknown = entry["id"];
  if (typeof id !== "string") {
    throw new MalformedProcessDocumentError(
      documentUrl,
      id === undefined ? "no `id` member" : `\`id\` is ${typeof id}, not a string`,
      where,
    );
  }
  if (id.trim() === "") {
    throw new MalformedProcessDocumentError(documentUrl, "`id` is blank", where);
  }
  return id;
}

export interface ParseSummaryOptions {
  /** The URL the carrying document was *served* from. Every href resolves against it. */
  readonly documentUrl: string;
  /** For error messages, e.g. `entry at index 3`. */
  readonly where: string;
  readonly report: ParseReport;
  readonly sink?: ObservationSink | undefined;
}

/**
 * The members every process object carries, summary or description alike.
 *
 * Shared so that the two parsers cannot drift: verified 2026-08-31 that ZOO's
 * summaries and descriptions agree on all 701 readable processes, and that
 * pygeoapi's description is its summary plus `inputs`, `outputs` and `example`.
 */
export function parseCommon(
  entry: unknown,
  options: ParseSummaryOptions,
): { summary: ProcessSummary; record: Record<string, unknown> } {
  const { documentUrl, where, report } = options;

  if (!isRecord(entry)) {
    throw new MalformedProcessDocumentError(
      documentUrl,
      `expected a JSON object, got ${Array.isArray(entry) ? "an array" : typeof entry}`,
      where,
    );
  }

  const id = requireId(entry, documentUrl, where);

  const title = optionalString(entry["title"]);
  const description = optionalString(entry["description"]);

  // The OGC schema marks `version` required. Both reference servers send it,
  // and enough do not that a missing one degrades rather than throwing.
  const version = optionalString(entry["version"]);
  if (entry["version"] === undefined) {
    report.warnings.push("version-absent");
  } else if (version === undefined) {
    report.warnings.push("version-is-not-a-usable-string");
  }

  const keywords = stringArray(entry["keywords"], report, "keywords");
  const outputTransmission = stringArray(
    entry["outputTransmission"],
    report,
    "output-transmission",
  );

  const links: readonly Link[] = resolveBodyLinks(documentUrl, readBodyLinks(entry), options.sink);

  const summary: ProcessSummary = {
    id,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(version === undefined ? {} : { version }),
    ...(keywords === undefined ? {} : { keywords }),
    execution: deriveExecution(entry["jobControlOptions"], report),
    outputTransmission: outputTransmission ?? [],
    links,
  };

  return { summary, record: entry };
}

/** One entry of the `processes` array. */
export function parseSummary(entry: unknown, options: ParseSummaryOptions): ProcessSummary {
  const { summary, record } = parseCommon(entry, options);
  noteUnrecognisedKeys(options.report, record, KNOWN_SUMMARY_KEYS);
  return summary;
}
