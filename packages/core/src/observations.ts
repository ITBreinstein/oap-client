/**
 * Structured observations — what the client saw, in a shape a findings report
 * can aggregate without re-parsing prose logs.
 *
 * Two rules hold everywhere:
 *
 * 1. **Observations are redacted at the point of creation, not at the sink.**
 *    A sink is written by the application; if redaction lived there, every
 *    application would have to get it right. {@link redactUrl} strips userinfo,
 *    query and fragment from every URL that reaches an observation, so a
 *    credential in a query string cannot leak through a log line.
 * 2. **A sink may not break the operation.** Emitting is wrapped, so a throwing
 *    sink is swallowed. Discovery failing because a logger threw would be an
 *    absurd way to lose a plugfest demo.
 */

/**
 * Origin and path only. Query strings carry API keys and callback tokens often
 * enough that keeping them is not worth the one time it would have been useful;
 * the flags on each observation record what the query *meant* instead.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Not a URL we can take apart, so we cannot promise it is safe to print.
    return "<unparseable-url>";
  }
}

/** Why a link advertised by a server was dropped rather than followed. */
export type SkippedLinkReason =
  "not-an-object" | "missing-href" | "missing-rel" | "unresolvable-href";

export type Observation =
  | {
      readonly kind: "landing-page-fetched";
      readonly url: string;
      readonly status: number;
      readonly mediaType: string | undefined;
      /** The server ignored `Accept` and only answered JSON for `?f=json`. */
      readonly usedFormatFallback: boolean;
      readonly redirected: boolean;
    }
  | {
      readonly kind: "conformance-link";
      /**
       * `path-fallback` means the landing page advertised no conformance link
       * and we guessed `./conformance`. That is a finding in its own right.
       */
      readonly source: "advertised" | "path-fallback";
      readonly url: string;
    }
  | {
      readonly kind: "conformance-fetched";
      readonly url: string;
      readonly status: number;
      readonly classCount: number;
      readonly unparseableCount: number;
      readonly usedFormatFallback: boolean;
    }
  | {
      /** A landing page without a usable conformance document: degraded, not dead. */
      readonly kind: "conformance-unavailable";
      readonly url: string;
      readonly reason: string;
    }
  | {
      readonly kind: "capabilities-derived";
      readonly sync: boolean;
      readonly async: boolean;
      readonly dismiss: boolean;
      readonly callback: boolean;
    }
  | {
      readonly kind: "link-skipped";
      /** The document that carried the bad link, redacted. */
      readonly documentUrl: string;
      readonly reason: SkippedLinkReason;
    }
  | {
      /**
       * Where the process list was looked for. `path-fallback` means either the
       * landing page advertised no `processes` link or discovery itself failed,
       * and `./processes` was guessed — a finding in its own right.
       */
      readonly kind: "processes-link";
      readonly source: "advertised" | "path-fallback";
      readonly url: string;
    }
  | {
      readonly kind: "process-list-fetched";
      /** The URL of the **last** page walked, redacted. */
      readonly url: string;
      readonly status: number;
      readonly usedFormatFallback: boolean;
      /** Pages actually fetched. 1 unless the server advertised `next`. */
      readonly pageCount: number;
      /** Summaries returned, after deduplication. */
      readonly processCount: number;
      /** Entries dropped because an earlier page already carried that id. */
      readonly duplicateCount: number;
      /** The walk stopped for our reasons, not the server's. */
      readonly truncated: boolean;
      readonly truncationReason: "page-cap" | "cycle" | undefined;
      /** The server's own `numberTotal`, when it declared a usable one. */
      readonly numberTotal: number | undefined;
      /** Structural degradations, as codes. Never carries a value from the document. */
      readonly warnings: readonly string[];
      /** Names only, of members this layer does not model. Vendor or v2-draft signal. */
      readonly unrecognisedKeys: readonly string[];
    }
  | {
      readonly kind: "process-fetched";
      readonly url: string;
      /** Server-chosen identifier, already present in the redacted path. */
      readonly processId: string;
      readonly status: number;
      readonly usedFormatFallback: boolean;
      /** Whether the server told us where the description lives, or we rebuilt it. */
      readonly route: "advertised-link" | "constructed-path";
      readonly inputCount: number;
      readonly outputCount: number;
      /** `jobControlOptions` verbatim; empty when the server declared none. */
      readonly declaredJobControlOptions: readonly string[];
      /** True when the OGC sync-only default was applied because nothing was declared. */
      readonly jobControlDefaulted: boolean;
      readonly warnings: readonly string[];
      readonly unrecognisedKeys: readonly string[];
      /**
       * The form-generation failure catalogue, assembling itself from real
       * traffic. Counts only — no input ids, titles, descriptions or values.
       *
       * Written out here rather than imported from `processes/types.ts` so this
       * module stays a leaf: everything above it depends on observations, and
       * nothing it depends on can then become a cycle.
       */
      readonly schemaShapes: {
        readonly total: number;
        readonly inlineType: number;
        readonly enumerated: number;
        readonly ref: number;
        readonly composed: number;
        readonly contentMediaType: number;
        readonly formatted: number;
        readonly absent: number;
      };
    };

export type ObservationKind = Observation["kind"];

/** Where observations go. Supplied by the application; never called with raw input values. */
export type ObservationSink = (observation: Observation) => void;

/**
 * Emit without letting the sink's failure become ours. Also tolerates an
 * `undefined` sink so call sites stay free of `if (sink !== undefined)`.
 */
export function observe(sink: ObservationSink | undefined, observation: Observation): void {
  if (sink === undefined) return;
  try {
    sink(observation);
  } catch {
    // A broken logger is not a broken service.
  }
}
