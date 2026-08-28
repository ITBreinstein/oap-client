/**
 * JSON content negotiation, and the `?f=json` fallback policy.
 *
 * pygeoapi content-negotiates, and so does almost everything else in this
 * ecosystem. A request that does not state its preference will eventually be
 * answered with a rendered HTML page — at which point `classify()` says `ok`,
 * quite correctly, because nothing went wrong at the HTTP level, and the first
 * sign of trouble is a parse error somewhere unrelated.
 *
 * Hence two rules, both enforced here rather than left to call sites:
 *
 * 1. **Every GET states `Accept: application/json`.** No exceptions.
 * 2. **Checking the media type is this layer's job, not the classifier's.**
 */

import { requireOk } from "../http/classify.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import type { FetchLike } from "../http/fetch.js";
import { send } from "../http/transport.js";
import { MalformedDocumentError, NotJsonError } from "../errors.js";

/** What every GET in this layer asks for. */
export const JSON_ACCEPT = "application/json";

/** The OGC format override. A convention, not a normative requirement. */
export const FORMAT_PARAM = "f";
export const FORMAT_JSON = "json";

export interface FetchJsonOptions {
  readonly fetch?: FetchLike | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface JsonDocument {
  readonly envelope: ResponseEnvelope;
  /** The parsed body. `unknown` deliberately: shape checking belongs to the caller. */
  readonly body: unknown;
  /** True when `Accept` alone was not enough and `?f=json` had to be added. */
  readonly usedFormatFallback: boolean;
  /** The URL we ended at differs from the one we asked for. */
  readonly redirected: boolean;
}

/**
 * Reject a document that is not JSON.
 *
 * Reuses the envelope's own `isJson`, which is `application/json` plus any
 * RFC 6839 `+json` structured suffix — so `application/geo+json` passes and
 * `text/html` does not. Deliberately not a string match on `"+json"` here:
 * that logic has one home, in `http/media-type.ts`, and duplicating it is how
 * the two drift apart.
 */
export function requireJson(envelope: ResponseEnvelope, triedFormatFallback = false): void {
  if (envelope.isJson) return;
  throw new NotJsonError(envelope.url, envelope.mediaType, triedFormatFallback);
}

/** True when the URL already carries `f=json`, so the fallback has nothing to add. */
function alreadyRequestsJson(url: string): boolean {
  try {
    return new URL(url).searchParams.get(FORMAT_PARAM) === FORMAT_JSON;
  } catch {
    return false;
  }
}

/** Append `f=json`, preserving every other query parameter the URL already had. */
export function withFormatJson(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(FORMAT_PARAM, FORMAT_JSON);
  return parsed.toString();
}

function get(url: string, options: FetchJsonOptions): Promise<ResponseEnvelope> {
  return send(url, {
    method: "GET",
    headers: { Accept: JSON_ACCEPT },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

async function parseBody(envelope: ResponseEnvelope): Promise<unknown> {
  try {
    return await envelope.json();
  } catch (cause) {
    // The server declared JSON and sent something else. That is a different
    // failure from sending HTML, and it gets a different error.
    throw new MalformedDocumentError(envelope.url, "body did not parse as JSON", { cause });
  }
}

/**
 * GET a JSON document, with exactly one `?f=json` retry.
 *
 * The policy, and the reasoning behind each clause:
 *
 * - **Never `f=json` on the first attempt.** It is an OGC convention rather
 *   than a normative requirement, and appending it blindly risks colliding with
 *   a server's own handling of an `f` parameter.
 * - **Retry once** if the first attempt answers with a non-JSON media type.
 * - **Fail with {@link NotJsonError}** if the retry is non-JSON too.
 * - **Skip the retry** when the URL already carried `f=json` — repeating an
 *   identical request cannot produce a different answer, and the extra round
 *   trip would only slow down the error.
 *
 * `requireOk` runs before the retry is considered, so a 404 HTML error page
 * raises a `ProcessesError` rather than being retried pointlessly.
 *
 * Which path succeeded is returned, not just logged: "this service ignores the
 * `Accept` header and requires `f=json`" is a genuine interoperability finding
 * and belongs in the matrix.
 */
export async function fetchJson(
  url: string,
  options: FetchJsonOptions = {},
): Promise<JsonDocument> {
  const first = await requireOk(await get(url, options));

  if (first.isJson) {
    return {
      envelope: first,
      body: await parseBody(first),
      usedFormatFallback: false,
      redirected: first.url !== url,
    };
  }

  // Retry against the URL the document was *served* from, not the one the
  // caller supplied. Retrying the pre-redirect URL repeats the redirect at
  // best, and asks a different server at worst; `first.url` is also always
  // absolute, so `new URL()` below cannot throw on a relative reference.
  if (alreadyRequestsJson(first.url)) {
    throw new NotJsonError(first.url, first.mediaType, true);
  }

  const retryUrl = withFormatJson(first.url);
  const second = await requireOk(await get(retryUrl, options));
  requireJson(second, true);

  return {
    envelope: second,
    body: await parseBody(second),
    usedFormatFallback: true,
    redirected: second.url !== retryUrl,
  };
}
