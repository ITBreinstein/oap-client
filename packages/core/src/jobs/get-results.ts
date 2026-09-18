/**
 * `getResults()` — a finished job's outputs, as an envelope.
 *
 * ## It does not parse, for the third time in this codebase
 *
 * Identical rule to `execute()`'s T4 and for the identical reason: a result may
 * be GeoJSON, a PNG, a zip, GML, or a JSON document wrapping several of those,
 * and the correct parse depends on a media type this layer has no opinion
 * about. §7.3 gives that decision to `apps/web`'s result adapters. The
 * {@link ResponseEnvelope} goes back whole, re-readable, with its
 * `Content-Type`, `Content-Disposition` and `Content-Crs` intact.
 *
 * It follows that this must **not** go through `fetchJson()`, whose whole job
 * is to insist on JSON. It uses `send()` + `requireOk()` directly.
 *
 * ## The Accept header, which step zero changed
 *
 * The brief said to send `Accept: * / *`, as `buildHeaders()` does for
 * execution. Against pygeoapi that is wrong, and expensively so:
 *
 *     GET /jobs/{id}/results          Accept: * / *
 *     HTTP/1.1 200 OK
 *     Content-Type: text/html
 *
 * pygeoapi content-negotiates this endpoint and treats `* / *` as permission to
 * render HTML — so the prescribed header returns a web page where the result
 * should be, on the one endpoint whose entire purpose is to deliver the result.
 * Finding 0036.
 *
 * So the header is `application/json, * / *;q=0.8`: JSON wins when the server
 * has a choice, and a result that is legitimately a PNG or a zip is still
 * acceptable and still arrives. ZOO ignores `Accept` entirely and always
 * answers JSON (finding 0012), so this costs nothing there.
 */

import { requireOk } from "../http/classify.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import { send } from "../http/transport.js";
import { findLink } from "../links/find.js";
import type { Link } from "../links/types.js";
import { observe, redactUrl } from "../observations.js";
import { resultsUrlFor } from "./job-url.js";
import type { JobRequestOptions, JobStatus } from "./types.js";

/**
 * Prefer JSON, accept anything.
 *
 * The `q=0.8` is what makes this different from a bare `* / *`: it states a
 * preference a content-negotiating server can act on, without refusing the
 * binary result that is the whole reason this endpoint is not `fetchJson()`.
 */
export const RESULTS_ACCEPT = "application/json, */*;q=0.8";

/** Whether the server told us where the results live, or we rebuilt the path. */
export type ResultsRoute = "advertised-link" | "constructed-path";

export interface GetResultsOptions extends JobRequestOptions {
  /**
   * The job document, when the caller has it. Its `results` link is preferred
   * over a constructed path — the same courtesy `execute()` extends to a
   * `ProcessDescription`'s `execute` link.
   */
  readonly status?: JobStatus | undefined;
  /** Links to search for a `results` relation, when there is no full status. */
  readonly links?: readonly Link[] | undefined;
}

export interface JobResults {
  /** Unparsed, deliberately. See the module comment. */
  readonly envelope: ResponseEnvelope;
  readonly route: ResultsRoute;
  /** The URL the results were actually read from. */
  readonly url: string;
}

/** The advertised `results` link, or the constructed `{statusUrl}/results`. */
export function resolveResultsUrl(
  statusUrl: string,
  links: readonly Link[],
): { url: string; route: ResultsRoute } {
  // `findLink` scores by media type, which matters here: pygeoapi advertises
  // the relation three times on a running job — `?f=html`, `?f=json`, and an
  // untyped `application/octet-stream` — and the JSON one is the one to take.
  const advertised = findLink(links, "results");
  if (advertised !== undefined) return { url: advertised.href, route: "advertised-link" };
  return { url: resultsUrlFor(statusUrl), route: "constructed-path" };
}

/**
 * Fetch a job's results.
 *
 * Throws through `requireOk()` for any non-ok response, which covers the two
 * live cases worth knowing about: pygeoapi answers 404 `ResultNotReady` for a
 * job that has not finished, and 400 for a job that failed. Both are genuine
 * refusals — a caller wanting the failure detail should read the job status,
 * where the server put it.
 */
export async function getResults(
  statusUrl: string,
  options: GetResultsOptions = {},
): Promise<JobResults> {
  const sink = options.onObservation;
  const links = options.status?.links ?? options.links ?? [];
  const { url, route } = resolveResultsUrl(statusUrl, links);

  const envelope = await send(url, {
    method: "GET",
    headers: { Accept: RESULTS_ACCEPT },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  try {
    await requireOk(envelope);
  } catch (error) {
    observe(sink, {
      kind: "job-results",
      url: redactUrl(url),
      route,
      status: envelope.status,
      mediaType: envelope.mediaType,
      contentCrsPresent: envelope.contentCrs !== undefined,
      filenamePresent: envelope.filename !== undefined,
      bodyTooLarge: envelope.bodyTooLarge,
      ok: false,
    });
    throw error;
  }

  observe(sink, {
    kind: "job-results",
    url: redactUrl(url),
    route,
    status: envelope.status,
    mediaType: envelope.mediaType,
    contentCrsPresent: envelope.contentCrs !== undefined,
    filenamePresent: envelope.filename !== undefined,
    // Declared `Content-Length` over the buffer limit. A chunked result has no
    // declared length and is buffered regardless — a known gap, tracked for the
    // October milestone rather than fixed here. See the README.
    bodyTooLarge: envelope.bodyTooLarge,
    ok: true,
  });

  return { envelope, route, url: envelope.url };
}
