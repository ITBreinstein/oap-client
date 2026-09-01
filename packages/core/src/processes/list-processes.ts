/**
 * `listProcesses()` — the process list, including the `rel="next"` walk.
 *
 * ## Why the walk exists, and why it is bounded
 *
 * A process list can be paginated, and a client that renders only the first
 * page — at a plugfest, missing the contractor's one interesting process — is a
 * bad afternoon. ZOO does paginate: `?limit=20` yields a `next` carrying
 * `skip=20`, and the last page correctly omits it. pygeoapi 0.21.0 does not
 * paginate at all.
 *
 * The walk stops at whichever comes first:
 *
 * - no `next` link — the server ran out, and nothing is truncated;
 * - a `next` href already visited. A server that points `next` at itself is a
 *   real bug in the wild, and an unguarded loop hangs the browser tab;
 * - {@link DEFAULT_MAX_PAGES}. Generous, and a ceiling all the same;
 * - the caller's abort signal, checked *between* pages and not only at the
 *   start.
 *
 * When one of the last three stops it, `truncated` is set on the result and
 * recorded in the observation, so the UI can say "showing the first N" rather
 * than quietly presenting a partial catalogue as the whole one.
 */

import { fetchJson, type FetchJsonOptions } from "../discovery/negotiate.js";
import { MalformedProcessDocumentError } from "../errors.js";
import { AbortError } from "../http/errors.js";
import { collectLinks } from "../links/resolve.js";
import { readBodyLinks } from "../links/resolve.js";
import { findLink } from "../links/find.js";
import type { Link } from "../links/types.js";
import { observe, redactUrl, type ObservationSink } from "../observations.js";
import { createReport, isRecord, parseSummary } from "./parse-summary.js";
import type { ProcessList, ProcessListTruncation, ProcessSummary } from "./types.js";

/** Twenty is generous for a catalogue and still a ceiling. */
export const DEFAULT_MAX_PAGES = 20;

export interface ListProcessesOptions extends FetchJsonOptions {
  readonly onObservation?: ObservationSink | undefined;
  /** Defaults to {@link DEFAULT_MAX_PAGES}. Values below 1 are raised to 1. */
  readonly maxPages?: number | undefined;
  /**
   * Page-size hint applied to the **first** request only; the walk then follows
   * whatever `next` the server builds.
   *
   * Not in the original brief. It is here because ZOO's unlimited default
   * returns all 703 summaries in one 500 kB document and advertises no `next`
   * at all — so without it there is no way to exercise the pagination walk
   * against a real server, only against mocks, and the whole lesson of the Task
   * 2 ZOO re-run was that mocks alone were not enough. It doubles as what an
   * endpoint screen wants for a first paint. pygeoapi 0.21.0 ignores it.
   */
  readonly limit?: number | undefined;
}

/** Apply the `limit` hint without disturbing any other parameter the URL carries. */
function withLimit(url: string, limit: number | undefined): string {
  if (limit === undefined) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("limit", String(limit));
  return parsed.toString();
}

/** A non-negative integer `numberTotal`, or nothing. Servers omit it more often than not. */
function readNumberTotal(body: Record<string, unknown>): number | undefined {
  const value: unknown = body["numberTotal"];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * An abort must reject, never degrade. Checked before each request so a
 * cancelled walk provably makes no further one, rather than relying on the
 * transport to notice mid-flight.
 */
function throwIfAborted(signal: AbortSignal | undefined, url: string): void {
  if (signal?.aborted === true) throw new AbortError(url);
}

/**
 * Fetch the process list, following `next`.
 *
 * `processesUrl` is where the list lives — resolved by the caller from the
 * `processes` link that `inspect()` found, never rebuilt here.
 *
 * Throws only for the fatal cases: a page that is not a JSON object, a
 * `processes` member that is not an array, or an entry with no string `id`.
 * Everything else degrades into the observation's `warnings`.
 */
export async function listProcesses(
  processesUrl: string,
  options: ListProcessesOptions = {},
): Promise<ProcessList> {
  const sink = options.onObservation;
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const report = createReport();

  const byId = new Map<string, ProcessSummary>();
  const visited = new Set<string>();

  let url = withLimit(processesUrl, options.limit);
  let pageCount = 0;
  let duplicateCount = 0;
  let truncationReason: ProcessListTruncation | undefined;
  let numberTotal: number | undefined;
  // Assigned on the first pass of a loop that always runs at least once; the
  // declarations carry no useful initial value, so they are left undeclared
  // rather than seeded with one that is never read.
  let lastLinks: readonly Link[];
  let lastStatus: number;
  let lastUrl: string;
  let usedFormatFallback = false;

  for (;;) {
    throwIfAborted(options.signal, url);

    const page = await fetchJson(url, options);
    pageCount += 1;
    lastStatus = page.envelope.status;
    lastUrl = page.envelope.url;
    usedFormatFallback = usedFormatFallback || page.usedFormatFallback;

    // Both the URL asked for and the one served, so a `next` that points at
    // either end of a redirect still counts as already visited.
    visited.add(url);
    visited.add(page.envelope.url);

    if (!isRecord(page.body)) {
      throw new MalformedProcessDocumentError(
        page.envelope.url,
        `expected a JSON object, got ${Array.isArray(page.body) ? "an array" : typeof page.body}`,
        `page ${String(pageCount)}`,
      );
    }

    const entries: unknown = page.body["processes"];
    if (!Array.isArray(entries)) {
      throw new MalformedProcessDocumentError(
        page.envelope.url,
        entries === undefined
          ? "no `processes` member"
          : `\`processes\` is ${typeof entries}, not an array`,
        `page ${String(pageCount)}`,
      );
    }

    entries.forEach((entry: unknown, index: number) => {
      const summary = parseSummary(entry, {
        documentUrl: page.envelope.url,
        where: `page ${String(pageCount)}, entry at index ${String(index)}`,
        report,
        ...(sink === undefined ? {} : { sink }),
      });
      // First occurrence wins: a server that repeats an id across pages has
      // told us the same thing twice, and the earlier page is the one the
      // caller's ordering already accounts for.
      if (byId.has(summary.id)) {
        duplicateCount += 1;
        return;
      }
      byId.set(summary.id, summary);
    });

    lastLinks = collectLinks(page.envelope, readBodyLinks(page.body), sink);
    if (numberTotal === undefined) numberTotal = readNumberTotal(page.body);

    const next = findLink(lastLinks, "next");
    if (next === undefined) break;

    if (visited.has(next.href)) {
      truncationReason = "cycle";
      break;
    }
    if (pageCount >= maxPages) {
      truncationReason = "page-cap";
      break;
    }

    url = next.href;
  }

  const processes = [...byId.values()];

  observe(sink, {
    kind: "process-list-fetched",
    url: redactUrl(lastUrl),
    status: lastStatus,
    usedFormatFallback,
    pageCount,
    processCount: processes.length,
    duplicateCount,
    truncated: truncationReason !== undefined,
    truncationReason,
    numberTotal,
    warnings: report.warnings,
    unrecognisedKeys: [...report.unrecognisedKeys],
  });

  return {
    processes,
    links: lastLinks,
    pageCount,
    truncated: truncationReason !== undefined,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(numberTotal === undefined ? {} : { numberTotal }),
  };
}
