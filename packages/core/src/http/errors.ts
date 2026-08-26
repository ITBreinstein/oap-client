/**
 * The core's error types. Everything thrown from the HTTP boundary is one of
 * these three, so a caller can discriminate without string-matching messages.
 */

import type { Classification, ClassificationKind } from "./classify.js";
import type { ProblemDetails } from "./problem.js";
import type { ResponseEnvelope } from "./envelope.js";

/**
 * The caller's `AbortSignal` fired. Distinct from {@link TransportError}: a
 * cancelled request is not a failing server, and nothing should be retried,
 * reported or recorded as a service defect because of it.
 *
 * The name matches the DOM's own abort exception, so `err.name === "AbortError"`
 * keeps working for callers that already check it.
 */
export class AbortError extends Error {
  override readonly name = "AbortError";
  /** The URL that was in flight. */
  readonly url: string;

  constructor(url: string, options?: { cause?: unknown }) {
    super(`Request to ${url} was aborted`, options);
    this.url = url;
  }
}

/**
 * `fetch` itself rejected: DNS failure, connection refused, TLS failure, or a
 * browser CORS block. These are genuinely indistinguishable — every one of them
 * surfaces as an opaque `TypeError: Failed to fetch`, deliberately, so that a
 * page cannot use fetch as a port scanner. We do not guess between them.
 *
 * What we record instead is {@link crossOrigin}: whether the request left the
 * page's origin at all. A cross-origin failure *might* be CORS; a same-origin
 * one cannot be. Turning that into a diagnosis is the observation layer's job.
 */
export class TransportError extends Error {
  override readonly name = "TransportError";
  readonly url: string;
  /** Undefined off-browser, where there is no page origin to compare against. */
  readonly crossOrigin: boolean | undefined;

  constructor(
    message: string,
    url: string,
    crossOrigin: boolean | undefined,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.url = url;
    this.crossOrigin = crossOrigin;
  }
}

/**
 * A response the server completed but that the operation cannot use: an OGC
 * exception (RFC 7807 problem document) or a bare HTTP error.
 *
 * Raised only by {@link requireOk}. Two operations deliberately never route
 * through it — see the comment there.
 */
export class ProcessesError extends Error {
  override readonly name = "ProcessesError";
  /** Which of the classifier's non-ok outcomes produced this. */
  readonly outcome: Exclude<ClassificationKind, "ok">;
  /** Final URL after redirects. */
  readonly url: string;
  /** The status on the wire, which may disagree with `problem.status`. */
  readonly status: number;
  /** Present only for the `exception` outcome. */
  readonly problem: ProblemDetails | undefined;
  /** Present only for the `http-error` outcome. */
  readonly bodyPreview: string | undefined;
  /** The full envelope, so a caller can inspect headers, links or the body. */
  readonly envelope: ResponseEnvelope;

  constructor(message: string, classification: Exclude<Classification, { kind: "ok" }>) {
    super(message);
    this.outcome = classification.kind;
    this.url = classification.envelope.url;
    this.status = classification.envelope.status;
    this.problem = classification.kind === "exception" ? classification.problem : undefined;
    this.bodyPreview =
      classification.kind === "http-error" ? classification.bodyPreview : undefined;
    this.envelope = classification.envelope;
  }
}

/** Reading a body that exceeded the configured buffer limit. Only `blob()` is available. */
export class BodyTooLargeError extends Error {
  override readonly name = "BodyTooLargeError";
  readonly url: string;
  /** The declared `Content-Length`. */
  readonly contentLength: number;
  readonly limit: number;

  constructor(url: string, contentLength: number, limit: number) {
    super(
      `Body of ${url} declares ${String(contentLength)} bytes, over the ${String(limit)}-byte ` +
        `buffer limit. Use blob() to stream it, or raise maxBufferBytes.`,
    );
    this.url = url;
    this.contentLength = contentLength;
    this.limit = limit;
  }
}
