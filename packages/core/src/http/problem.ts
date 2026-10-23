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

/**
 * The OGC API - Processes exception types the core names, from Part 1's
 * `…/def/exceptions/ogcapi-processes-1/1.0/{name}`. 1.0 defines the first
 * three; the 2.0 draft (OGC 18-062r3 at 756b659) adds `result-not-available`
 * (404, a result that will never be there) and `no-such-output` (400, an
 * output the process does not have).
 */
export type OgcException =
  | "no-such-process"
  | "no-such-job"
  | "result-not-ready"
  | "result-not-available"
  | "no-such-output";

const OGC_EXCEPTIONS: ReadonlySet<string> = new Set<OgcException>([
  "no-such-process",
  "no-such-job",
  "result-not-ready",
  "result-not-available",
  "no-such-output",
]);

/**
 * The OGC exception a problem's `type` names, or undefined.
 *
 * **The scheme is not compared.** 1.0 writes these URIs with `http://`; the
 * draft moved all but one to `https://` and left `no-such-output` on `http://`
 * (its issue #619). Either spelling names the same exception, so only the host
 * and the path are read. The version segment is not compared either: the
 * draft still writes `…/ogcapi-processes-1/1.0/…`.
 */
export function ogcExceptionOf(type: string): OgcException | undefined {
  let url: URL;
  try {
    url = new URL(type);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.hostname.toLowerCase() !== "www.opengis.net") return undefined;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const [def, exceptions, family, , name, ...rest] = segments;
  if (def !== "def" || exceptions !== "exceptions" || family !== "ogcapi-processes-1") {
    return undefined;
  }
  if (rest.length > 0 || name === undefined || !isOgcException(name)) return undefined;
  return name;
}

function isOgcException(name: string): name is OgcException {
  return OGC_EXCEPTIONS.has(name);
}

export interface ProblemDetails {
  /** RFC 7807 defaults an absent `type` to `about:blank`. */
  readonly type: string;
  /**
   * The OGC exception `type` names, whether written `http://` or `https://`.
   * Absent for any other type: pygeoapi's `NoSuchProcess` is a `code` in
   * {@link extensions}, not a type, and is not guessed at.
   */
  readonly ogcException?: OgcException;
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
 * The same check as `links/resolve.ts`'s `isRecord`. The http layer sits below
 * every module that exports one, so it keeps its own.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
 *    which RFC 7807 requires and `"process"` is not — *and* the body carries a
 *    `detail` or claims a failing numeric `status`. A URI-shaped `type` alone
 *    is not enough: a process result is free to carry one (`"urn:…"`,
 *    `"EPSG:4326"`), and on a synchronous execute this test decides whether
 *    the result is handed over or thrown away as an exception;
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

  const claimed = record["status"];
  const claimsFailure = typeof claimed === "number" && claimed >= 400;
  if (type !== undefined && URI_SHAPED.test(type)) {
    if (typeof record["detail"] === "string" || claimsFailure) return true;
  }

  return title !== undefined && claimsFailure;
}

/** Reads a parsed JSON body as a problem document, or returns undefined. */
export function toProblemDetails(
  body: unknown,
  context: ProblemContext,
): ProblemDetails | undefined {
  if (!isRecord(body)) return undefined;
  if (!looksLikeProblem(body, context)) return undefined;

  // A declared problem+json with neither `type` nor `title` is still a problem
  // document: RFC 9457 §3.1.1 reads a missing `type` as `about:blank`. Dropped,
  // `{"detail":"backend unavailable","status":503}` served at 200 was taken
  // for a result (review C7). An undeclared body without either never gets
  // here: `looksLikeProblem` refuses it.
  const type = stringOrUndefined(body["type"]);
  const title = stringOrUndefined(body["title"]);

  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!KNOWN_MEMBERS.has(key)) extensions[key] = value;
  }

  const claimed = body["status"];
  const ogcException = type === undefined ? undefined : ogcExceptionOf(type);

  return {
    type: type ?? "about:blank",
    ...(ogcException === undefined ? {} : { ogcException }),
    title,
    // A string status is out of spec and common; it is dropped rather than
    // coerced into a NaN that would look like a real number downstream.
    status: typeof claimed === "number" ? claimed : undefined,
    detail: stringOrUndefined(body["detail"]),
    instance: stringOrUndefined(body["instance"]),
    extensions: Object.freeze(extensions),
  };
}
