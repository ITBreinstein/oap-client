/**
 * The classifier: envelope in, one of three outcomes out.
 *
 * This is the module that justifies the envelope having no `ok` field. Whether
 * a response is usable cannot be read off the status line:
 *
 * - A **200 carrying a problem document** is not ok. Servers do this — a
 *   gateway rewrites the status, or a framework serialises an exception through
 *   a success path. A status check calls it ok and the failure surfaces later,
 *   somewhere unrelated, as a missing field.
 * - A **404** may be exactly the answer a capability probe wanted.
 *
 * So classification reads the body, and it must never throw: a classifier that
 * fails on a malformed body turns a diagnosable server bug into a stack trace
 * from inside our own error handling.
 */

import type { ResponseEnvelope } from "./envelope.js";
import { toProblemDetails, type ProblemDetails } from "./problem.js";
import { ProcessesError } from "./errors.js";

/** Enough of the body to diagnose an HTML error page without logging the whole thing. */
export const BODY_PREVIEW_LIMIT = 500;

export type ClassificationKind = "ok" | "exception" | "http-error";

export interface OkClassification {
  readonly kind: "ok";
  readonly envelope: ResponseEnvelope;
}

/** The server said what went wrong, in the format the standard asks for. */
export interface ExceptionClassification {
  readonly kind: "exception";
  readonly envelope: ResponseEnvelope;
  readonly problem: ProblemDetails;
}

/** A failing status with no problem document: an HTML error page, a proxy, an empty body. */
export interface HttpErrorClassification {
  readonly kind: "http-error";
  readonly envelope: ResponseEnvelope;
  /** Truncated to {@link BODY_PREVIEW_LIMIT}; empty if the body could not be read. */
  readonly bodyPreview: string;
}

export type Classification = OkClassification | ExceptionClassification | HttpErrorClassification;

/**
 * Wrapped so that *any* failure — not JSON, truncated, wrong shape, body
 * already gone, over the buffer limit — means "not a problem document" and
 * falls through, rather than escaping as an error of our own.
 */
async function readProblem(envelope: ResponseEnvelope): Promise<ProblemDetails | undefined> {
  if (!envelope.isJson) return undefined;
  try {
    return toProblemDetails(await envelope.json(), {
      declared: envelope.mediaType === "application/problem+json",
      wireStatus: envelope.status,
    });
  } catch {
    return undefined;
  }
}

async function readPreview(envelope: ResponseEnvelope): Promise<string> {
  try {
    const body = await envelope.text();
    return body.length > BODY_PREVIEW_LIMIT ? `${body.slice(0, BODY_PREVIEW_LIMIT)}…` : body;
  } catch {
    // An unreadable body is not itself a classification failure.
    return "";
  }
}

export async function classify(envelope: ResponseEnvelope): Promise<Classification> {
  // Checked at every status, not just >= 400. That is the whole point.
  const problem = await readProblem(envelope);
  if (problem !== undefined) return { kind: "exception", envelope, problem };

  if (envelope.status >= 400) {
    return { kind: "http-error", envelope, bodyPreview: await readPreview(envelope) };
  }

  return { kind: "ok", envelope };
}

function message(classification: Exclude<Classification, OkClassification>): string {
  const { envelope } = classification;
  const where = `${String(envelope.status)} from ${envelope.url}`;

  if (classification.kind === "exception") {
    const { problem } = classification;
    const what = problem.title ?? problem.detail ?? problem.type;
    // The body's own status is only worth printing when it contradicts the wire.
    const claimed =
      problem.status !== undefined && problem.status !== envelope.status
        ? ` (body claims status ${String(problem.status)})`
        : "";
    return `${where}${claimed}: ${what}`;
  }

  const preview = classification.bodyPreview.trim();
  return preview === "" ? where : `${where}: ${preview}`;
}

/**
 * Classify, and throw a {@link ProcessesError} unless the outcome is ok.
 *
 * Every normal operation routes through here, so that "the server said no" is
 * one error type with the problem document attached, rather than each operation
 * inventing its own.
 *
 * Two operations arriving later must deliberately **not** use it, and call
 * {@link classify} directly instead:
 *
 * 1. **Job status polling.** A failed job is a perfectly valid 200 — the job
 *    document says `status: "failed"`. That has to resolve so the caller can
 *    read the exception the job carries; throwing here would discard it.
 * 2. **Capability probes.** A 405 on `DELETE /jobs/{id}` is the answer the probe
 *    asked for: this server does not support dismiss. Recording it as a
 *    capability is the point; raising it as a failure is noise.
 */
export async function requireOk(envelope: ResponseEnvelope): Promise<ResponseEnvelope> {
  const classification = await classify(envelope);
  if (classification.kind === "ok") return classification.envelope;
  throw new ProcessesError(message(classification), classification);
}
