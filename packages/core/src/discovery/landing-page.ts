/**
 * The landing page: the one document whose structure everything else hangs off.
 *
 * Validation here is deliberately lopsided. The body must be a JSON *object* —
 * an array or a bare string is not a landing page by any reading, and pretending
 * otherwise just defers the failure. Everything below that degrades: a missing
 * title is not an error, a `links` member that is not an array is not an error,
 * and an unusable individual link is not an error. A service under test is
 * exactly the service that gets those wrong, and each one is a finding worth
 * recording rather than a reason to refuse to talk to it.
 */

import { MalformedDocumentError } from "../errors.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import { collectLinks, readBodyLinks } from "../links/resolve.js";
import type { Link } from "../links/types.js";
import type { ObservationSink } from "../observations.js";

export interface LandingPage {
  /** The URL the landing page was actually served from, after redirects. */
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  /** Header links and body links, merged, every href absolute. */
  readonly links: readonly Link[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Validate and destructure a landing-page body.
 *
 * Links are resolved against `envelope.url` — the post-redirect URL — by way of
 * `collectLinks`, which is the only thing that knows how to do it. The
 * user-supplied base URL is not a parameter of this function and never will be.
 */
export function parseLandingPage(
  envelope: ResponseEnvelope,
  body: unknown,
  sink?: ObservationSink,
): LandingPage {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new MalformedDocumentError(
      envelope.url,
      `expected a JSON object, received ${Array.isArray(body) ? "an array" : typeof body}`,
    );
  }

  const record = body as Record<string, unknown>;
  const title = optionalString(record["title"]);
  const description = optionalString(record["description"]);

  return {
    url: envelope.url,
    // Spread rather than assign undefined: `exactOptionalPropertyTypes` draws a
    // real distinction between an absent member and one set to undefined, and
    // "the server sent no title" is the absent case.
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    links: collectLinks(envelope, readBodyLinks(body), sink),
  };
}
