/**
 * The transport: URL and options in, {@link ResponseEnvelope} out.
 *
 * What it does not do, all deliberately:
 *
 * - **It does not retry, poll or back off.** Those are policies, and a policy
 *   needs to know what the operation is. A 202 with Retry-After means one thing
 *   to a job poller and nothing at all to a capability probe.
 * - **It does not throw on 4xx or 5xx.** A 404 is information. Deciding it is a
 *   failure requires reading the body, which is the classifier's job.
 * - **It does not interpret.** No unwrapping, no shape checks, no defaults.
 *
 * It is the only place in the core that catches from `fetch`.
 */

import { createEnvelope, type ResponseEnvelope } from "./envelope.js";
import { AbortError, TransportError } from "./errors.js";
import { resolveFetch, type FetchLike } from "./fetch.js";

export interface SendOptions extends RequestInit {
  /** Defaults to the ambient `fetch`. This is the seam `createClient` injects through. */
  readonly fetch?: FetchLike | undefined;
  /** Content-Length above which the body is not buffered. See DEFAULT_MAX_BUFFER_BYTES. */
  readonly maxBufferBytes?: number | undefined;
}

/**
 * The page's origin, or undefined off-browser.
 *
 * Reached through `globalThis` on purpose. A bare `location` is banned in the
 * core by `no-restricted-globals`, and rightly: it does not exist in Node. This
 * guarded lookup is the runtime-neutral form of the same question — off-browser
 * it answers "there is no page", which is exactly the `crossOrigin: undefined`
 * we want to record.
 */
function pageOrigin(): string | undefined {
  const ambient: unknown = (globalThis as { location?: unknown }).location;
  if (typeof ambient !== "object" || ambient === null) return undefined;
  const origin: unknown = (ambient as { origin?: unknown }).origin;
  return typeof origin === "string" && origin !== "" && origin !== "null" ? origin : undefined;
}

function isCrossOrigin(url: string): boolean | undefined {
  const page = pageOrigin();
  if (page === undefined) return undefined;
  try {
    return new URL(url, page).origin !== page;
  } catch {
    return undefined;
  }
}

function isAbortError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const name: unknown = (cause as { name?: unknown }).name;
  // TimeoutError is what AbortSignal.timeout() produces.
  return name === "AbortError" || name === "TimeoutError";
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function send(
  url: string | URL,
  options: SendOptions = {},
): Promise<ResponseEnvelope> {
  const { fetch: injected, maxBufferBytes, ...init } = options;
  const requestedUrl = url.toString();
  const doFetch = resolveFetch(injected);

  let response: Response;
  try {
    response = await doFetch(requestedUrl, init);
  } catch (cause) {
    // An aborted request is the caller's own doing and must not be mistaken for
    // a broken server. Check the signal first: some runtimes reject with a
    // plain TypeError even when the abort is what caused it.
    if (options.signal?.aborted === true || isAbortError(cause)) {
      throw new AbortError(requestedUrl, { cause });
    }

    // Past here we know only that the request never produced a response. A CORS
    // block and a dead host are the same opaque TypeError by design — the
    // browser will not tell us which, so we record `crossOrigin` and stop.
    throw new TransportError(
      `Request to ${requestedUrl} failed before a response arrived: ${describe(cause)}`,
      requestedUrl,
      isCrossOrigin(requestedUrl),
      { cause },
    );
  }

  return createEnvelope(response, {
    requestedUrl,
    ...(maxBufferBytes === undefined ? {} : { maxBufferBytes }),
  });
}
