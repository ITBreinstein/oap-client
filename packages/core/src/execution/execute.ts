/**
 * `execute()` — the single POST that turns a library into a product.
 *
 * What it does not do, all deliberately:
 *
 * - **It does not parse the response.** T4. The correct parse depends on a
 *   media type this layer has no opinion about, and §7.3 gives that decision to
 *   `apps/web`'s result adapters. The envelope goes back whole.
 * - **It does not retry.** A failed execution is a finding, not something to
 *   paper over — and retrying a non-idempotent POST is how you get two jobs.
 * - **It does not validate input values.** §7.2 gives the schema's meaning to
 *   the web app. Arity is the one exception, and only as a warning.
 * - **It does not poll.** Task 5.
 */

import { requireOk } from "../http/classify.js";
import type { ResponseEnvelope } from "../http/envelope.js";
import { AbortError, ProcessesError } from "../http/errors.js";
import { send } from "../http/transport.js";
import { ExecutionTimeoutError } from "../errors.js";
import { observe, redactUrl } from "../observations.js";
import { buildRequest } from "./build-request.js";
import { classifyExecution, gatherEvidence } from "./classify-execution.js";
import { DEFAULT_EXECUTE_TIMEOUT_MS, type Execution, type ExecuteOptions } from "./types.js";

/**
 * One signal that fires for either reason, and remembers which.
 *
 * `AbortSignal.any` would do most of this, but it is Node 20+ and this package
 * supports Node 18, and it would also lose the part that matters: *which* of
 * the two fired. "The user cancelled" and "the server never answered" are
 * different facts about a service, and a matrix that cannot tell them apart
 * cannot say whether synchronous execution is viable for real work. See T8.
 */
function withDeadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = (): void => {
    controller.abort(signal?.reason);
  };

  if (signal !== undefined) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Start a process.
 *
 * `processesUrl` is only used for the constructed-path fallback; when
 * `options.description` carries an `execute` link — which both reference
 * servers advertise — that link wins and this is not read.
 *
 * Returns as soon as the server answers. Whether that answer is the result or a
 * job is decided by {@link classifyExecution} from the response's own evidence,
 * and both outcomes are ordinary — neither is an error.
 */
export async function execute(
  processesUrl: string,
  processId: string,
  options: ExecuteOptions = {},
): Promise<Execution> {
  const sink = options.onObservation;
  const requestedMode = options.mode ?? "sync";
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS;
  const request = buildRequest(processesUrl, processId, options);

  // Two timestamps, and they buy a matrix column: how long each service takes
  // to answer synchronously is the evidence behind any recommendation about
  // whether sync execution is usable for real calculations at all.
  const startedAt = Date.now();
  const deadline = withDeadline(options.signal, timeoutMs);

  /** Everything an observation needs that is known before the response is. */
  const base = {
    kind: "execution" as const,
    url: redactUrl(request.url),
    processId,
    route: request.route,
    requestedMode,
    requestedResponse: options.response,
    outputsSupplied: options.outputs !== undefined,
    warnings: request.warnings,
    inputIds: request.inputIds,
    inputKinds: request.inputKinds,
  };

  let envelope: ResponseEnvelope;
  try {
    envelope = await send(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: deadline.signal,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    });
  } catch (cause) {
    observe(sink, {
      ...base,
      outcome: "transport-failure",
      status: undefined,
      mediaType: undefined,
      elapsedMs: Date.now() - startedAt,
      resultKind: undefined,
      disagreedWithRequestedMode: false,
      discoveredVia: undefined,
      locationPresent: false,
      jobIdKnown: false,
      problemPresent: false,
      unrecognisedKeys: [],
    });
    // A deadline that fired reaches us as an AbortError from the transport,
    // because that is what an aborted signal produces. Only this function knows
    // it was ours rather than the caller's.
    if (deadline.timedOut() && cause instanceof AbortError) {
      throw new ExecutionTimeoutError(request.url, timeoutMs, { cause });
    }
    throw cause;
  } finally {
    deadline.dispose();
  }

  const elapsedMs = Date.now() - startedAt;

  try {
    // T5. The classifier decides; we do not read the status ourselves. Finding
    // 0016 is why: ZOO answers a rejected input with 500, so the status alone
    // cannot say whether the server broke or the user typed something wrong,
    // and the core must not pretend to resolve that. Whatever problem document
    // exists travels on the error so the UI can show the server's own words.
    // Finding 0014 also applies — ZOO answers an unknown path with 400, not
    // 404 — so nothing here special-cases a status.
    await requireOk(envelope);
  } catch (cause) {
    observe(sink, {
      ...base,
      outcome: "error",
      status: envelope.status,
      mediaType: envelope.mediaType,
      elapsedMs,
      resultKind: undefined,
      disagreedWithRequestedMode: false,
      discoveredVia: undefined,
      locationPresent: envelope.locationRaw !== undefined,
      jobIdKnown: false,
      problemPresent: cause instanceof ProcessesError && cause.problem !== undefined,
      unrecognisedKeys: [],
    });
    throw cause;
  }

  const evidence = await gatherEvidence(envelope, sink);
  const execution = classifyExecution(envelope, evidence, requestedMode);
  const asked = requestedMode === "async" ? "job" : "immediate";

  observe(sink, {
    ...base,
    outcome: execution.kind,
    status: envelope.status,
    mediaType: envelope.mediaType,
    elapsedMs,
    resultKind: execution.kind,
    // The divergence the interoperability matrix exists to hold: asked for one
    // thing, got the other. Recordable only because both facts survive on the
    // union.
    disagreedWithRequestedMode: execution.kind !== asked,
    discoveredVia: execution.kind === "job" ? execution.job.discoveredVia : undefined,
    locationPresent: evidence.locationPresent,
    jobIdKnown: execution.kind === "job" && execution.job.jobId !== undefined,
    problemPresent: false,
    unrecognisedKeys: evidence.unrecognisedKeys,
  });

  return execution;
}
