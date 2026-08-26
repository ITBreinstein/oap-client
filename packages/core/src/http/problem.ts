/**
 * RFC 7807 / RFC 9457 problem details — the exception format OGC API -
 * Processes requires (`/req/core/job-exception`, `/req/core/process-exception`).
 */

/** Members RFC 7807 defines; everything else the server sent lands in `extensions`. */
const KNOWN_MEMBERS: ReadonlySet<string> = new Set([
  "type",
  "title",
  "status",
  "detail",
  "instance",
]);

/** `about:blank`, an absolute URI, or a relative reference starting with `/`. */
const URI_SHAPED = /^(?:[a-z][a-z0-9+.-]*:|\/)/i;

export interface ProblemDetails {
  /** RFC 7807 defaults an absent `type` to `about:blank`. */
  readonly type: string;
  readonly title: string | undefined;
  /**
   * The status the *body* claims. This is not necessarily the status on the
   * wire — see `ResponseEnvelope.status`. Servers disagree with themselves
   * surprisingly often, and that disagreement is itself a finding, so the two
   * are never reconciled here.
   */
  readonly status: number | undefined;
  readonly detail: string | undefined;
  readonly instance: string | undefined;
  /** Server-specific members, e.g. pygeoapi's `code` and `description`, kept verbatim. */
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface ProblemContext {
  /** The response declared `application/problem+json`. */
  readonly declared: boolean;
  /** The status on the wire. */
  readonly wireStatus: number;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Is this JSON body a problem document?
 *
 * "Has a `type` or `title`" is the obvious test, and it is wrong. Both members
 * collide with ordinary OGC API - Processes payloads:
 *
 * - a job document is `{"type": "process", "status": "successful", ...}`
 * - every process description and landing page carries a `title`
 *
 * Under the obvious test, a successful job poll reads as an exception. So a
 * body qualifies only when one of these holds:
 *
 * 1. the server **declared** `application/problem+json` — it said so, we
 *    believe it, whatever the status;
 * 2. the wire status is already >= 400 and the body is problem-shaped — the
 *    response is a failure either way, so the only question is whether we can
 *    name it;
 * 3. `type` is URI-shaped (`about:blank`, `https://…`, `urn:…`, `/errors/…`) —
 *    which RFC 7807 requires and `"process"` is not;
 * 4. the body itself claims a failing numeric `status` alongside a `title`.
 *
 * 1, 3 and 4 are what catch a **200 carrying a problem document** — a real
 * server bug that a status check reports as success and that then surfaces
 * later, somewhere unrelated, as a missing field.
 */
function looksLikeProblem(record: Record<string, unknown>, context: ProblemContext): boolean {
  if (context.declared) return true;

  const type = stringOrUndefined(record["type"]);
  const title = stringOrUndefined(record["title"]);
  if (type === undefined && title === undefined) return false;

  if (context.wireStatus >= 400) return true;
  if (type !== undefined && URI_SHAPED.test(type)) return true;

  const claimed = record["status"];
  return title !== undefined && typeof claimed === "number" && claimed >= 400;
}

/** Reads a parsed JSON body as a problem document, or returns undefined. */
export function toProblemDetails(
  body: unknown,
  context: ProblemContext,
): ProblemDetails | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;

  const record = body as Record<string, unknown>;
  if (!looksLikeProblem(record, context)) return undefined;

  const type = stringOrUndefined(record["type"]);
  const title = stringOrUndefined(record["title"]);
  // A declared problem+json with neither member is still a problem document,
  // but one with no usable content is not worth reporting as an exception.
  if (type === undefined && title === undefined) return undefined;

  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_MEMBERS.has(key)) extensions[key] = value;
  }

  const claimed = record["status"];

  return {
    type: type ?? "about:blank",
    title,
    // A string status is out of spec and common; it is dropped rather than
    // coerced into a NaN that would look like a real number downstream.
    status: typeof claimed === "number" ? claimed : undefined,
    detail: stringOrUndefined(record["detail"]),
    instance: stringOrUndefined(record["instance"]),
    extensions: Object.freeze(extensions),
  };
}
