/**
 * The process list and the process description, as types.
 *
 * These are the shapes the whole product is built on: the generated form, the
 * bounding-box draw tool, the execute request body and the result renderers all
 * read from here. They are deliberately *preservative* rather than
 * interpretive. Deciding that one input deserves a number field and another a
 * map draw tool is `apps/web`'s job; this layer's only obligation is to hand
 * that decision every piece of evidence the server gave, unaltered.
 *
 * Same split the codebase already uses twice: the envelope preserves the HTTP
 * response and `classify()` interprets it; discovery preserves the raw
 * conformance list and `ServiceCapabilities` interprets it.
 */

import type { Link } from "../links/types.js";

/**
 * A JSON Schema object as it arrives from the server, passed through untouched.
 *
 * **The core never reads, rewrites, validates or dereferences this object.**
 * What comes out is deep-equal to what came in — no key filtering, no
 * defaulting, no normalising, no rewriting of `$ref` into an absolute URL.
 * There is a test pinning exactly that.
 *
 * The keys the form generator will want first, and what the two reference
 * servers actually put in them (censused 2026-08-31 over 5 098 inputs across
 * ZOO's 701 readable descriptions and pygeoapi 0.21.0's one):
 *
 * - `type` (3 662), `default` (3 269), `nullable` (2 990), `oneOf` (1 436),
 *   `format` (1 285), `enum` (1 279), `minimum`/`maximum` (125 each),
 *   `required` and `properties` (4 each).
 * - `format: "ogc-bbox"` on a `type: "object"` with `properties.bbox` and
 *   `properties.crs` is how a bounding box actually shows up. Not a `$ref`.
 * - `$ref` appears **only** inside ZOO's vendor `extended-schema` sibling,
 *   never inside `schema` itself.
 * - `contentMediaType` and `contentEncoding` appear nested inside `oneOf`
 *   branches, never at the top level of a `schema`.
 *
 * ## Why the members are not typed
 *
 * The obvious interface names those keys with narrow types — `type?: string |
 * readonly string[]`, `format?: string` — over an open index signature. It
 * reads better and it is a claim this layer cannot keep: nothing here checks
 * that `type` is a string, because checking it would mean either rejecting a
 * schema (losing evidence, which is the one thing forbidden here) or lying
 * about having checked. A server that sends `"type": 42` would hand `apps/web`
 * a value typed `string` that is a number, and the failure would surface in a
 * `switch` somewhere far from the parse.
 *
 * `unknown` per key is the honest form. It is exactly what `isRecord()` proves
 * at runtime, and it forces the form generator to narrow at the point of use —
 * which it has to do anyway, because a foreign server can put anything here.
 */
export interface JsonSchema {
  readonly [key: string]: unknown;
}

/**
 * What a server says it will do with an execute request for this process.
 *
 * `declared` is the evidence; the three booleans are the convenience.
 * `defaulted` is the honesty flag: it separates "the server told us sync-only"
 * from "the server said nothing and the spec default is sync-only". The
 * interoperability matrix needs that distinction — it is the same
 * declared / observed / ambiguous split already in use for conformance.
 */
export interface ProcessExecutionOptions {
  readonly sync: boolean;
  readonly async: boolean;
  readonly dismiss: boolean;
  /** `jobControlOptions` verbatim, in document order. Empty when absent. */
  readonly declared: readonly string[];
  /** True when nothing usable was declared and the OGC default was applied. */
  readonly defaulted: boolean;
}

export interface ProcessSummary {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly version?: string;
  readonly keywords?: readonly string[];
  readonly execution: ProcessExecutionOptions;
  readonly outputTransmission: readonly string[];
  /** Fully resolved absolute hrefs, resolved against the document's own URL. */
  readonly links: readonly Link[];
}

export interface InputDescription {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly minOccurs: number;
  readonly maxOccurs: number | "unbounded";
  /**
   * `minOccurs >= 1`. Derived here rather than left to each caller because the
   * OGC default is **required**, which is the opposite of what a reader coming
   * from JSON Schema expects. See `cardinality.ts`.
   */
  readonly required: boolean;
  /**
   * `maxOccurs` is `"unbounded"` or greater than 1. Changes the wire shape the
   * execute request has to send — an array rather than a bare value — so it is
   * derived here too.
   */
  readonly multiple: boolean;
  /** Verbatim. Never `undefined`: an absent schema degrades to `{}` and warns. */
  readonly schema: JsonSchema;
}

export interface OutputDescription {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  /** Verbatim. Never `undefined`: an absent schema degrades to `{}` and warns. */
  readonly schema: JsonSchema;
}

/**
 * `extends ProcessSummary` because the description document really does contain
 * everything the summary does — verified across all 701 readable ZOO
 * descriptions and pygeoapi's one, where the two agreed on every modelled field.
 * So a `ProcessDescription` is usable anywhere a `ProcessSummary` is, which is
 * what lets the web app render the list header from either.
 */
export interface ProcessDescription extends ProcessSummary {
  /**
   * An array, though the wire shape is an object keyed by input id.
   *
   * A form renders by iterating in a stable order, and JavaScript object key
   * order is only guaranteed for keys that do not look like integers — an input
   * id of `"1"` would silently jump to the front. An array is also what
   * `.map()` wants, so the web app never converts it back.
   */
  readonly inputs: readonly InputDescription[];
  readonly outputs: readonly OutputDescription[];
}

/** Why a pagination walk stopped before the server ran out of `next` links. */
export type ProcessListTruncation = "page-cap" | "cycle";

export interface ProcessList {
  /** Deduplicated by id, first occurrence winning, in page order. */
  readonly processes: readonly ProcessSummary[];
  /** The links of the **last** page fetched, resolved absolute. */
  readonly links: readonly Link[];
  /** How many pages were fetched. 1 unless the server advertised `next`. */
  readonly pageCount: number;
  /**
   * True when the walk stopped for our own reasons rather than the server's.
   * A UI holding a truncated list must say "showing the first N" rather than
   * presenting it as the whole catalogue.
   */
  readonly truncated: boolean;
  readonly truncationReason?: ProcessListTruncation;
  /**
   * The server's own `numberTotal`, when it declared one and it was a
   * non-negative integer.
   *
   * Not in the brief; kept because ZOO sends it (`703`) and it is the only way
   * a UI can say "20 of 703" on the first page. pygeoapi 0.21.0 sends nothing.
   */
  readonly numberTotal?: number;
}

/**
 * Counts, and only counts, of the schema shapes one description used.
 *
 * This is the form-generation failure catalogue assembling itself from real
 * traffic rather than being reconstructed by hand in October. Deliberately
 * carries no input ids, titles, descriptions or values — nothing that could
 * hold user or service-sensitive content.
 */
export interface SchemaShapeCensus {
  /** Inputs looked at. `absent` is included in this. */
  readonly total: number;
  /** Has a `type` keyword. */
  readonly inlineType: number;
  readonly enumerated: number;
  readonly ref: number;
  /** Has `oneOf`, `allOf` or `anyOf`. */
  readonly composed: number;
  readonly contentMediaType: number;
  /** Has a `format` keyword — the key `"ogc-bbox"` actually turns up in. */
  readonly formatted: number;
  /** No `schema` member at all, or one that was not a JSON object. */
  readonly absent: number;
}

/** Which route resolved a URL: the server told us, or we rebuilt it. */
export type ResolutionRoute = "advertised-link" | "constructed-path";
