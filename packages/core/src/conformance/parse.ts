/**
 * Conformance URI parsing.
 *
 * The important decision here is **parse, do not string-compare**. A
 * conformance class URI carries its version inside it:
 *
 *   http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/core
 *                          └─ family ──┘ part └ ver ┘      └name┘
 *
 * Matching whole strings against a hardcoded list means every draft-v2 URI —
 * `.../ogcapi-processes-1/2.0/conf/core` — reads as "unknown", and the client
 * silently reports a v2 service as supporting nothing. Splitting the URI makes
 * a v2 class *recognised at a different version* instead.
 *
 * That is the whole of the v2 story in this task, deliberately. Recognising a
 * version is not negotiating one: no compatibility shims, no branching on
 * version, no framework. Per §6.4 those belong in a small dated module written
 * when a real service demands it.
 */

import { MalformedDocumentError } from "../errors.js";

export interface ConformanceClass {
  /** The URI exactly as the server sent it. */
  readonly uri: string;
  /** Specification family without the part number, e.g. `ogcapi-processes`. */
  readonly family: string;
  /** Part number, e.g. `1` for `ogcapi-processes-1`. */
  readonly part: number;
  /** Version as written, e.g. `1.0`. Kept as a string: it is a label, not a number. */
  readonly version: string;
  /** Conformance class name, e.g. `core`, `ogc-process-description`. */
  readonly name: string;
}

export interface ParsedConformance {
  /** Every URI we could take apart. */
  readonly classes: readonly ConformanceClass[];
  /** Every URI we could not. Kept, never discarded — see below. */
  readonly unparseable: readonly string[];
  /**
   * Every *string* entry as received, parseable or not.
   *
   * We never discard evidence, but we never invent it either: a non-string
   * entry has no verbatim form to preserve, so it is counted in
   * {@link unparseable} rather than coerced into something the server did not
   * send. A URI shape we do not recognise today is exactly the kind of thing a
   * findings report needs to quote verbatim in October.
   */
  readonly raw: readonly string[];
}

/** `ogcapi-processes-1` → family `ogcapi-processes`, part `1`. */
function splitFamily(segment: string): { family: string; part: number } | undefined {
  const dash = segment.lastIndexOf("-");
  if (dash <= 0) return undefined;
  const part = Number(segment.slice(dash + 1));
  if (!Number.isInteger(part) || part < 0) return undefined;
  return { family: segment.slice(0, dash), part };
}

/**
 * Split one conformance URI into its structural parts.
 *
 * Works on path segments rather than a regex over the whole URI, so the scheme
 * and host are irrelevant — a server that serves `https://` variants of the OGC
 * URIs, which happens, parses identically.
 */
export function parseConformanceUri(uri: string): ConformanceClass | undefined {
  let segments: string[];
  try {
    segments = new URL(uri).pathname.split("/").filter((segment) => segment !== "");
  } catch {
    return undefined;
  }

  const spec = segments.indexOf("spec");
  const conf = segments.indexOf("conf", spec + 1);
  // Need `spec/{family}/{version}/conf/{name}`: conf sits exactly two past spec,
  // and at least one segment must follow it.
  if (spec === -1 || conf !== spec + 3 || conf === segments.length - 1) return undefined;

  const familySegment = segments[spec + 1];
  const version = segments[spec + 2];
  if (familySegment === undefined || version === undefined) return undefined;

  const split = splitFamily(familySegment);
  if (split === undefined) return undefined;

  return {
    uri,
    family: split.family,
    part: split.part,
    version,
    // Rejoined: a few classes are multi-segment, and flattening them to the
    // first segment would merge distinct classes into one.
    name: segments.slice(conf + 1).join("/"),
  };
}

/**
 * Parse a conformance document's `conformsTo` array.
 *
 * Throws {@link MalformedDocumentError} when the document is not shaped like a
 * conformance document at all. Discovery catches that and degrades — a service
 * with a broken conformance document is still a service whose processes we can
 * list — but the error type stays available to callers that want to be strict.
 */
export function parseConformance(document: unknown, url: string): ParsedConformance {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new MalformedDocumentError(url, "expected a JSON object with a conformsTo member");
  }

  const conformsTo: unknown = (document as Record<string, unknown>)["conformsTo"];
  if (!Array.isArray(conformsTo)) {
    throw new MalformedDocumentError(
      url,
      conformsTo === undefined
        ? "no conformsTo member"
        : `conformsTo is ${typeof conformsTo}, expected an array`,
    );
  }

  const classes: ConformanceClass[] = [];
  const unparseable: string[] = [];
  const raw: string[] = [];

  for (const entry of conformsTo as readonly unknown[]) {
    // A non-string entry has no verbatim form to preserve, so it is counted as
    // unparseable rather than coerced into something the server never sent.
    if (typeof entry !== "string") {
      unparseable.push(String(entry));
      continue;
    }
    raw.push(entry);
    const parsed = parseConformanceUri(entry);
    if (parsed === undefined) {
      unparseable.push(entry);
    } else {
      classes.push(parsed);
    }
  }

  return {
    classes: Object.freeze(classes),
    unparseable: Object.freeze(unparseable),
    raw: Object.freeze(raw),
  };
}
