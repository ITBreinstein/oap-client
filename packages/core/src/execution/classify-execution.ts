/**
 * Deciding what the server did with the execute request — from the evidence in
 * the response, never from what we asked for.
 *
 * ## Why not `if (mode === "async")`
 *
 * Because the server decides, not the client. A server may return a job for a
 * request that did not ask for one, and may run something synchronously despite
 * `Prefer: respond-async`, because `Prefer` is a preference and not a command.
 * The union has to be right either way, so the branch is on what came back.
 *
 * ## The ordering, and why it is not the ordering the brief specified
 *
 * The brief's first rule was "status 201 or 202, **or** a `Location` header
 * present → job". Step zero, 2026-09-01, says the second half of that is wrong,
 * and expensively so:
 *
 *     POST /processes/hello-world/execution     (no Prefer header)
 *     HTTP/1.1 200 OK
 *     Content-Type: application/json
 *     Location: http://localhost:5080/jobs/2d979ce4-…
 *
 *     {"id":"echo","value":"Hello plugfest!"}
 *
 * pygeoapi 0.21.0 sends `Location` on **every** synchronous execution — and on
 * 400s too — while the body carries the actual, finished result. The job it
 * points at is real (`GET`ting it returns `status: "successful"`), so the header
 * is not a bug so much as pygeoapi recording every execution as a job. But
 * treating it as the discriminator would classify every pygeoapi synchronous
 * run as `{ kind: "job" }`, throw the answer away, and hand the web app a status
 * document to render where the result should be. That is the sync-execution
 * demo path, so this is not a hypothetical cost. See finding 0024.
 *
 * So `Location` is demoted from *evidence that a job exists* to *a route to a
 * job we have already concluded exists*, and the ordering becomes:
 *
 * 1. status 201 or 202 → job. Both reference servers use exactly this, and only
 *    this, for async: 201 with `Preference-Applied: respond-async`.
 * 2. any other success carrying a JSON body shaped like a job document — a
 *    `status` in the OGC job vocabulary, usually with `jobID` — → job. Some
 *    servers do answer 200 with a job document, and reading that as an
 *    immediate result is the same mistake in the other direction.
 * 3. otherwise → immediate.
 *
 * Rule 2 is what keeps the brief's intent: a 200 that really *is* a job is
 * still caught, on stronger evidence than a header that two servers disagree
 * about the meaning of.
 */

import { AmbiguousExecutionResponseError } from "../errors.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import { readBodyLinks, resolveBodyLinks } from "../links/resolve.js";
import { findLink } from "../links/find.js";
import type { Link } from "../links/types.js";
import type { ObservationSink } from "../observations.js";
import type { Execution, ExecutionMode, JobHandle } from "./types.js";

/**
 * The OGC job status vocabulary, verbatim per the house naming rule. A body
 * whose `status` is one of these is a job document and not a result.
 */
const JOB_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "running",
  "successful",
  "failed",
  "dismissed",
]);

/**
 * Members of a job document this layer models. Anything else at the top level
 * is recorded by name — vendor extension or v2 draft, and either way not
 * something to drop silently. Same rule as Task 3.
 */
const KNOWN_JOB_MEMBERS: ReadonlySet<string> = new Set([
  "jobID",
  "id",
  "status",
  "message",
  "created",
  "started",
  "finished",
  "updated",
  "progress",
  "percentCompleted",
  "processID",
  "type",
  "links",
  "exception",
]);

/** What the response looked like, kept so an error can name all of it at once. */
export interface ExecutionEvidence {
  readonly status: number;
  /** True when a `Location` header was *readable*. False cross-origin is finding 0002. */
  readonly locationPresent: boolean;
  readonly mediaType: string | undefined;
  /** Parsed only when the media type said JSON and parsing actually worked. */
  readonly body: unknown;
  readonly bodyLinks: readonly Link[];
  /** Top-level members of a job document this layer does not model. Names only. */
  readonly unrecognisedKeys: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the body, but only when there is reason to believe it is JSON.
 *
 * Two guards, both earned. `isJson` covers the `+json` suffix and `charset`
 * parameters that ZOO's vendor media type exposed in Task 1. The `try` covers
 * the case `isJson` cannot: ZOO's raw mode returns **GML** under
 * `Content-Type: application/json;charset=UTF-8` (finding 0026), so a body that
 * declares JSON and is not JSON is a live, reproducible response and must not
 * turn classification into a stack trace.
 *
 * This is the only place in the execution layer that calls `.json()`, and it is
 * for classification alone — T4. The envelope handed back to the caller is
 * untouched and re-readable.
 */
async function readJsonBody(envelope: ResponseEnvelope): Promise<unknown> {
  if (!envelope.isJson) return undefined;
  try {
    return await envelope.json();
  } catch {
    return undefined;
  }
}

/** Everything the classifier and the observation both want, gathered once. */
export async function gatherEvidence(
  envelope: ResponseEnvelope,
  sink?: ObservationSink,
): Promise<ExecutionEvidence> {
  const body = await readJsonBody(envelope);
  const bodyLinks = resolveBodyLinks(envelope.url, readBodyLinks(body), sink);

  const unrecognisedKeys =
    isRecord(body) && isJobDocument(body)
      ? Object.keys(body).filter((key) => !KNOWN_JOB_MEMBERS.has(key))
      : [];

  return {
    status: envelope.status,
    locationPresent: envelope.locationRaw !== undefined,
    mediaType: envelope.mediaType,
    body,
    bodyLinks,
    unrecognisedKeys,
  };
}

/**
 * A job document, on the only evidence that distinguishes one from a result:
 * a `status` member carrying a value from the OGC job vocabulary.
 *
 * Deliberately not "has a `jobID`" — a result document is free to contain that
 * — and deliberately not `type: "process"`, which ZOO sends but pygeoapi's
 * sync result does not, and which collides with problem details (finding 0003).
 */
export function isJobDocument(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const status: unknown = body["status"];
  return typeof status === "string" && JOB_STATUSES.has(status.toLowerCase());
}

/** `jobID`, then `id`, then the last path segment of the status URL. */
function readJobId(body: unknown, statusUrl: string): string | undefined {
  if (isRecord(body)) {
    for (const key of ["jobID", "id"] as const) {
      const value: unknown = body[key];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
  }
  try {
    const segments = new URL(statusUrl).pathname.split("/").filter((part) => part !== "");
    const tail = segments[segments.length - 1];
    return tail === undefined ? undefined : decodeURIComponent(tail);
  } catch {
    return undefined;
  }
}

/**
 * Where the job reports its status, and how we found out.
 *
 * The order matters more in a browser than in Node, which is exactly why it
 * exists before the browser E2E tests can prove anything. `Location` is not a
 * CORS-safelisted response header, so a cross-origin request cannot read it
 * unless the server sends `Access-Control-Expose-Headers: Location` — and
 * neither reference server does (findings 0002 and 0009, both re-confirmed
 * 2026-09-01). In Node the header route works perfectly; in a browser, against
 * the same server, it silently vanishes.
 *
 * The fallback is real, not theoretical: ZOO's async 201 carries a job document
 * whose `links` include `rel="monitor"` pointing at the job, so a browser can
 * still find it. pygeoapi's async 201 body is the literal `null` (finding
 * 0004), so for that server the fallback has nothing to work with and the
 * browser genuinely cannot name the job it just created. That contrast is the
 * evidence behind the proposed guidance that nLDT services must expose
 * `Location`.
 */
function findStatusUrl(
  envelope: ResponseEnvelope,
  bodyLinks: readonly Link[],
): { statusUrl: string; discoveredVia: JobHandle["discoveredVia"] } | undefined {
  // Already resolved against the *final* URL by the envelope, so a relative
  // `Location` — legal, and common behind a gateway — lands in the right place.
  if (envelope.location !== undefined) {
    return { statusUrl: envelope.location, discoveredVia: "location-header" };
  }
  const monitor = findLink(bodyLinks, "monitor") ?? findLink(bodyLinks, "self");
  if (monitor !== undefined) return { statusUrl: monitor.href, discoveredVia: "body-link" };
  return undefined;
}

/**
 * Envelope in, one arm of {@link Execution} out.
 *
 * Throws {@link AmbiguousExecutionResponseError} only when the evidence says a
 * job was created and offers no way to reach it. Guessing there would produce a
 * job handle pointing nowhere, which fails later and somewhere else.
 */
export function classifyExecution(
  envelope: ResponseEnvelope,
  evidence: ExecutionEvidence,
  requestedMode: ExecutionMode,
): Execution {
  const created = envelope.status === 201 || envelope.status === 202;
  const jobShaped = isJobDocument(evidence.body);

  if (!created && !jobShaped) {
    return { kind: "immediate", response: envelope, requestedMode };
  }

  const found = findStatusUrl(envelope, evidence.bodyLinks);
  if (found === undefined) {
    throw new AmbiguousExecutionResponseError(
      envelope.url,
      envelope.status,
      evidence.locationPresent,
      evidence.mediaType,
      evidence.bodyLinks.map((link) => link.rel),
    );
  }

  const jobId = readJobId(evidence.body, found.statusUrl);

  return {
    kind: "job",
    requestedMode,
    job: {
      statusUrl: found.statusUrl,
      ...(jobId === undefined ? {} : { jobId }),
      links: evidence.bodyLinks,
      discoveredVia: found.discoveredVia,
    },
  };
}
