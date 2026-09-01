/**
 * `getProcess()` — one process description, link-first.
 *
 * ## Link-first, and what step zero actually found
 *
 * The rule everywhere in this core is: never rebuild a URL the server already
 * gave you. Finding 0008 is that rule from one direction and finding 0017 from
 * the other, and a service behind a gateway or a path prefix only works at all
 * because of it.
 *
 * The brief for this task expected the constructed path to be the *primary*
 * route against ZOO, on the strength of finding 0017 — ZOO's process
 * descriptions carry no `self` link. Checked against both live servers on
 * 2026-08-31, that is not what happens, because it is the wrong document:
 *
 * - Every one of ZOO's 703 **list entries** carries
 *   `rel="self", type="application/json"` pointing at its own description. It
 *   is only the description document, once fetched, that omits `self`.
 * - pygeoapi's list entry does too, at `…/processes/hello-world?f=json`.
 *
 * So link-first is the live route on both servers, and the constructed path is
 * a genuine fallback rather than the main road. That is a better answer than
 * the brief expected, and finding 0017 stands unchanged — it was about a
 * different document.
 *
 * The fallback still has to be right, because a caller that has not fetched the
 * list has no link to follow. Hence {@link processUrlFor}, and hence
 * `encodeURIComponent`.
 */

import { fetchJson, type FetchJsonOptions } from "../discovery/negotiate.js";
import { ProcessNotFoundError } from "../errors.js";
import { ProcessesError } from "../http/errors.js";
import { findLink } from "../links/find.js";
import { observe, redactUrl, type ObservationSink } from "../observations.js";
import { parseDescription } from "./parse-description.js";
import type { ProcessDescription, ProcessSummary, ResolutionRoute } from "./types.js";

export interface GetProcessOptions extends FetchJsonOptions {
  readonly onObservation?: ObservationSink | undefined;
  /**
   * The list entry for this process, when the caller already has it.
   *
   * Its `self` link is preferred over a constructed path. This is the ordinary
   * case in the UI — the user clicks a row of a list that has already been
   * fetched — and it is the route both reference servers actually advertise.
   */
  readonly summary?: ProcessSummary | undefined;
}

/**
 * Build `{processesUrl}/{id}`.
 *
 * `encodeURIComponent` is not optional. Process ids are server-chosen and turn
 * up in the wild containing `:` and `.`; an id with a space or a slash would
 * otherwise produce a different URL than intended, or a request to a different
 * resource entirely. Neither reference server currently exposes an id that
 * needs encoding — ZOO's 703 are all unreserved characters — which is exactly
 * why this is pinned by a unit test rather than left to be discovered live.
 *
 * The trailing slash goes on the *path*, not the end of the string: a list URL
 * reached through the `?f=json` fallback ends in a query, and appending there
 * produces `…/processes?f=json/`, whose path is still `/processes`, so the
 * relative reference replaces the last segment and the guess lands one level
 * too high. Query and fragment are then dropped, because they belonged to the
 * list request and carrying an API key onto a different resource is a guess we
 * have no basis for.
 */
export function processUrlFor(processesUrl: string, processId: string): string {
  const base = new URL(processesUrl);
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  base.search = "";
  base.hash = "";
  return new URL(encodeURIComponent(processId), base).toString();
}

/** Which URL to ask, and how we got it. */
export function resolveProcessUrl(
  processesUrl: string,
  processId: string,
  summary: ProcessSummary | undefined,
): { url: string; route: ResolutionRoute } {
  const advertised = summary === undefined ? undefined : findLink(summary.links, "self");
  if (advertised !== undefined) return { url: advertised.href, route: "advertised-link" };
  return { url: processUrlFor(processesUrl, processId), route: "constructed-path" };
}

/**
 * A 404 on a description is a normal user-facing situation — a mistyped or
 * withdrawn id — and the UI should say "no such process on this service", not
 * "HTTP 404". Everything else propagates as the transport's own error.
 *
 * Both reference servers reach this cleanly: pygeoapi answers 404 with a
 * `NoSuchProcess` exception body, ZOO with the OGC `no-such-process` exception
 * URI. Finding 0014 — ZOO answering 400 for an unknown *path* — does not apply,
 * because ZOO routes `/processes/{id}` and gets that status right.
 */
function asNotFound(error: unknown, processId: string): unknown {
  if (error instanceof ProcessesError && error.status === 404) {
    return new ProcessNotFoundError(processId, error.url, { cause: error });
  }
  return error;
}

/**
 * Fetch and parse one process description.
 *
 * `processesUrl` is only used for the constructed-path fallback; when
 * `options.summary` carries a `self` link, that link wins and this is not read.
 */
export async function getProcess(
  processesUrl: string,
  processId: string,
  options: GetProcessOptions = {},
): Promise<ProcessDescription> {
  const sink = options.onObservation;
  const { url, route } = resolveProcessUrl(processesUrl, processId, options.summary);

  const document = await fetchJson(url, options).catch((error: unknown) => {
    throw asNotFound(error, processId);
  });

  const parsed = parseDescription(document.body, {
    documentUrl: document.envelope.url,
    requestedId: processId,
    ...(sink === undefined ? {} : { sink }),
  });

  observe(sink, {
    kind: "process-fetched",
    url: redactUrl(document.envelope.url),
    processId,
    status: document.envelope.status,
    usedFormatFallback: document.usedFormatFallback,
    route,
    inputCount: parsed.process.inputs.length,
    outputCount: parsed.process.outputs.length,
    declaredJobControlOptions: parsed.process.execution.declared,
    jobControlDefaulted: parsed.process.execution.defaulted,
    warnings: parsed.report.warnings,
    unrecognisedKeys: [...parsed.report.unrecognisedKeys],
    schemaShapes: parsed.census,
  });

  return parsed.process;
}
