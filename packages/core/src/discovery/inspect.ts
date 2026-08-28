/**
 * `inspect()` — landing page, then conformance, then capabilities.
 *
 * This is the first function in the core that follows links rather than
 * building paths, and the reason is operational rather than aesthetic. Testbed
 * services from the topic #1 and #2 contractors will sit behind gateways and
 * under path prefixes nobody can predict. A client that concatenates
 * `${baseUrl}/processes` breaks the first time a server mounts its API
 * somewhere unexpected, and we find that out live. Link-following works
 * regardless, because the server tells us where its own resources are.
 *
 * Standard paths remain, but only as a *fallback* — and using one is recorded
 * as a finding, because a service that does not advertise its own conformance
 * link is telling us something about itself.
 */

import { unknownCapabilities, type ServiceCapabilities } from "../conformance/capabilities.js";
import { deriveCapabilities } from "../conformance/capabilities.js";
import { parseConformance } from "../conformance/parse.js";
import { AbortError, ProcessesError } from "../http/errors.js";
import { MalformedDocumentError, NotJsonError } from "../errors.js";
import type { FetchLike } from "../http/fetch.js";
import { findLink } from "../links/find.js";
import type { Link } from "../links/types.js";
import { observe, redactUrl, type ObservationSink } from "../observations.js";
import { parseLandingPage } from "./landing-page.js";
import { fetchJson } from "./negotiate.js";

export interface ServiceDescription {
  /** The URL the landing page was actually served from, after redirects. */
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  /** Header and body links merged, deduped, every href absolute. */
  readonly links: readonly Link[];
  readonly capabilities: ServiceCapabilities;
}

export interface InspectOptions {
  readonly fetch?: FetchLike | undefined;
  readonly maxBufferBytes?: number | undefined;
  /**
   * Cancellation, threaded into *both* requests.
   *
   * §6.5 requires every long-running operation to be cancellable, and the
   * pattern is established here rather than retrofitted. A user who mistypes a
   * URL and corrects it must not have the first lookup racing the second — the
   * loser of that race would otherwise overwrite the winner's result.
   */
  readonly signal?: AbortSignal | undefined;
  readonly onObservation?: ObservationSink | undefined;
}

/**
 * Resolve `./conformance` against a landing-page URL.
 *
 * The trailing slash has to go on the *path*, not on the end of the string: a
 * landing page reached through the `?f=json` fallback ends in a query, and
 * appending there produces `…/oapi?f=json/`, whose path is still `/oapi` — so
 * the relative reference replaces the last segment and the guess lands at the
 * origin root. That defeats the path-prefix handling this whole module exists
 * for, and it does so only on the fallback path, where it is least likely to
 * be noticed.
 *
 * Query and fragment are dropped deliberately. They belonged to the landing
 * page request; carrying `?f=json` or an API key onto a different resource is
 * a guess we have no basis for.
 */
function conformanceFallback(landingUrl: string): string {
  const base = new URL(landingUrl);
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  base.search = "";
  base.hash = "";
  return new URL("conformance", base).toString();
}

/** An abort is the caller's own doing and must never be swallowed as degradation. */
function isAbort(error: unknown): boolean {
  return error instanceof AbortError || (error instanceof Error && error.name === "AbortError");
}

/**
 * A reason string safe to put in an observation.
 *
 * Deliberately *not* `error.message`: every error in this core names the URL it
 * failed on, and `ProcessesError` additionally carries up to 500 characters of
 * response body. Both would walk straight past the redaction that
 * `observations.ts` promises callers, through a field that looks harmless.
 *
 * The error's class plus one non-identifying detail is enough to act on.
 */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (error instanceof NotJsonError) {
    return `NotJsonError (${error.mediaType ?? "no media type"})`;
  }
  if (error instanceof ProcessesError) return `ProcessesError (status ${String(error.status)})`;
  if (error instanceof MalformedDocumentError) return `MalformedDocumentError (${error.reason})`;
  return error.name;
}

/**
 * Resolve where the conformance document lives.
 *
 * Advertised link first. Only if the landing page carries none do we guess
 * `./conformance` — resolved with `URL` against the *served* landing-page URL,
 * so a service under a path prefix still gets the right answer.
 */
function conformanceUrl(
  links: readonly Link[],
  landingUrl: string,
  sink: ObservationSink | undefined,
): string {
  const advertised = findLink(links, "conformance");
  if (advertised !== undefined) {
    observe(sink, {
      kind: "conformance-link",
      source: "advertised",
      url: redactUrl(advertised.href),
    });
    return advertised.href;
  }

  const guessed = conformanceFallback(landingUrl);
  observe(sink, { kind: "conformance-link", source: "path-fallback", url: redactUrl(guessed) });
  return guessed;
}

/**
 * Fetch and parse conformance, degrading to {@link unknownCapabilities} on any
 * failure short of an abort.
 *
 * A service that serves a valid landing page but a broken conformance document
 * is degraded, not dead: the UI can still list and run processes, and every
 * optional button simply greys out. Refusing the whole service over a missing
 * side document would be the wrong trade in every direction.
 */
async function readCapabilities(
  url: string,
  options: InspectOptions,
  sink: ObservationSink | undefined,
): Promise<ServiceCapabilities> {
  try {
    const document = await fetchJson(url, options);
    const parsed = parseConformance(document.body, document.envelope.url);

    observe(sink, {
      kind: "conformance-fetched",
      url: redactUrl(document.envelope.url),
      status: document.envelope.status,
      classCount: parsed.classes.length,
      unparseableCount: parsed.unparseable.length,
      usedFormatFallback: document.usedFormatFallback,
    });

    return deriveCapabilities(parsed);
  } catch (error) {
    if (isAbort(error)) throw error;
    observe(sink, {
      kind: "conformance-unavailable",
      url: redactUrl(url),
      reason: describe(error),
    });
    return unknownCapabilities();
  }
}

/**
 * Fetch a service's landing page and conformance document, and describe it.
 *
 * Throws only when the landing page itself is unusable — unreachable, a server
 * error, HTML after the `?f=json` fallback, or not a JSON object. Everything
 * downstream of that degrades and is recorded.
 */
export async function inspect(
  baseUrl: string | URL,
  options: InspectOptions = {},
): Promise<ServiceDescription> {
  const sink = options.onObservation;
  const requestedUrl = baseUrl.toString();

  const landing = await fetchJson(requestedUrl, options);
  observe(sink, {
    kind: "landing-page-fetched",
    url: redactUrl(landing.envelope.url),
    status: landing.envelope.status,
    mediaType: landing.envelope.mediaType,
    usedFormatFallback: landing.usedFormatFallback,
    redirected: landing.redirected,
  });

  const page = parseLandingPage(landing.envelope, landing.body, sink);
  const capabilities = await readCapabilities(
    conformanceUrl(page.links, page.url, sink),
    options,
    sink,
  );

  observe(sink, {
    kind: "capabilities-derived",
    sync: capabilities.sync,
    async: capabilities.async,
    dismiss: capabilities.dismiss,
    callback: capabilities.callback,
  });

  return {
    url: page.url,
    ...(page.title === undefined ? {} : { title: page.title }),
    ...(page.description === undefined ? {} : { description: page.description }),
    links: page.links,
    capabilities,
  };
}
