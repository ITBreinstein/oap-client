/**
 * Building the execute request: where to send it, what headers it carries, and
 * what goes in the body.
 *
 * Split out from `execute.ts` so that every one of these decisions is testable
 * without a fetch. The `Content-Type` assertion in particular has to be a unit
 * test — see T1 — because the live version of that test crashes a server.
 */

import { findLink } from "../links/find.js";
import type { ProcessDescription, ResolutionRoute } from "../processes/types.js";
import type {
  ExecuteInputValue,
  ExecuteOptions,
  ExecuteOutputSelection,
  ExecutionMode,
} from "./types.js";

/**
 * The body we send, with every member optional.
 *
 * `outputs` and `response` are present **only** when the caller supplied them.
 * Synthesising either is forbidden by T9 and the reasoning survived contact
 * with both servers, though not comfortably — see the note on
 * {@link buildPayload}.
 */
export interface ExecutePayload {
  readonly inputs?: Readonly<Record<string, ExecuteInputValue>>;
  readonly outputs?: Readonly<Record<string, ExecuteOutputSelection>>;
  readonly response?: "document" | "raw";
}

/** Everything `send()` needs, plus the evidence the observation wants. */
export interface ExecuteRequest {
  readonly url: string;
  /** Whether the server told us where to POST, or we rebuilt the path. */
  readonly route: ResolutionRoute;
  readonly headers: Readonly<Record<string, string>>;
  /** Already serialised, so the `Content-Length` the runtime derives is right. */
  readonly body: string;
  /** The object `body` was serialised from. For assertions, never for the wire. */
  readonly payload: ExecutePayload;
  /** Arity mismatches found against the description. Never blocks. See T3. */
  readonly warnings: readonly string[];
  /** Input ids, in the order supplied. Ids are safe to record; values are not. */
  readonly inputIds: readonly string[];
  /** Value *kinds* parallel to {@link inputIds}, e.g. `"array of 4 numbers"`. */
  readonly inputKinds: readonly string[];
}

/**
 * Build `{processesUrl}/{id}/execution`.
 *
 * Same trailing-slash and `encodeURIComponent` reasoning as `processUrlFor` in
 * `processes/get-process.ts`, and for the same reasons: a list URL reached
 * through the `?f=json` fallback ends in a query, and a server-chosen process
 * id may contain characters that would otherwise change which resource is
 * addressed.
 *
 * Only reached when the description advertises no `execute` link. Both
 * reference servers do advertise one, so this is a genuine fallback rather than
 * the main road — but a caller that never fetched a description has no link to
 * follow, which is exactly when a rebuilt path has to be correct.
 */
export function executionUrlFor(processesUrl: string, processId: string): string {
  const base = new URL(processesUrl);
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  base.search = "";
  base.hash = "";
  return new URL(`${encodeURIComponent(processId)}/execution`, base).toString();
}

/**
 * Which URL to POST to, and how we got it.
 *
 * Link-first, per T9. Verified 2026-09-01: pygeoapi 0.21.0 advertises
 * `http://www.opengis.net/def/rel/ogc/1.0/execute` at
 * `…/processes/hello-world/execution?f=json`, and ZOO advertises the same
 * relation at `…/processes/echo/execution`. Neither writes the short form,
 * which is why `findLink` matches both spellings.
 */
export function resolveExecutionUrl(
  processesUrl: string,
  processId: string,
  description: ProcessDescription | undefined,
): { url: string; route: ResolutionRoute } {
  const advertised = description === undefined ? undefined : findLink(description.links, "execute");
  if (advertised !== undefined) return { url: advertised.href, route: "advertised-link" };
  return { url: executionUrlFor(processesUrl, processId), route: "constructed-path" };
}

/**
 * The headers every execute request carries.
 *
 * **`Content-Type: application/json` is not optional.** Not because the
 * specification says so, though it does, but because finding 0015 says the
 * alternative crashes a live server's kernel: `fetch(url, { method: "POST",
 * body: someString })` sets `text/plain;charset=UTF-8` all by itself, and ZOO
 * answers that with signal 11, SIGSEGV. This is the header whose absence is
 * invisible until it takes down someone else's process.
 *
 * **`Accept` is the wildcard, explicitly.** Not the same as omitting it: a browser given
 * no `Accept` supplies its own ranked list with `text/html` first and gets back
 * a web page (finding 0007). An explicit wildcard overrides that list without
 * constraining what the server may return — and a synchronous execution may
 * legitimately return a PNG, a zip, or GML.
 *
 * The brief offered a refinement — `application/json` when the caller asked for
 * `response: "document"` — conditional on step-zero question 9 supporting it.
 * It does not. Neither server varies its answer by `Accept` on the execution
 * endpoint: the wildcard, `application/json`, a full browser list, and no
 * header at all all produce identical responses. So the refinement is not
 * taken, and one unconditional header is sent instead of two conditional ones.
 */
export function buildHeaders(mode: ExecutionMode): Readonly<Record<string, string>> {
  return Object.freeze({
    "Content-Type": "application/json",
    Accept: "*/*",
    // Sync is the default in Part 1 v1.0 and sends nothing: `Prefer` is a
    // preference, and asking for the default is noise a server may still echo
    // back in `Preference-Applied`.
    ...(mode === "async" ? { Prefer: "respond-async" } : {}),
  });
}

/** A short, value-free description of what kind of thing an input was. */
export function describeInputKind(value: ExecuteInputValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const kinds = new Set(value.map((entry: unknown) => describeInputKind(entry)));
    const of = kinds.size === 1 ? [...kinds][0] : "mixed";
    return `array of ${String(value.length)} ${String(of)}`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["href"] === "string") return "reference";
    if ("value" in record) return "qualified value";
    return "object";
  }
  return typeof value;
}

/**
 * Arity checks against the description. **Warns; never throws, never rewrites.**
 *
 * Task 3 derived `multiple` for exactly this moment: an input whose `maxOccurs`
 * exceeds 1 must be a JSON array on the wire, and one whose `maxOccurs` is 1
 * must not be. Getting it wrong produces a rejection that reads like a client
 * bug.
 *
 * The core does not fix it silently, for a reason the servers themselves make
 * concrete. Task 3 found 1 541 inputs with an absent `minOccurs` and one live
 * `"unbounded"`; a core that refused to send a request because it disagreed
 * with a description could not be used to probe a server that under-declares —
 * which both of these do. Sending anyway is also how finding 0016 was
 * reproducible at all.
 *
 * The `required` warning carries a real judgement call: a missing required
 * input might be the server's own default kicking in. Warn, record, send
 * anyway, let the server answer. Verified worth doing — pygeoapi answers a
 * missing required input with a usable 400, ZOO with a 500 (finding 0016), and
 * neither is something the core can predict from the description alone.
 */
export function checkArity(
  description: ProcessDescription | undefined,
  inputs: Readonly<Record<string, ExecuteInputValue>> | undefined,
): readonly string[] {
  if (description === undefined) return [];

  const warnings: string[] = [];
  for (const input of description.inputs) {
    const supplied = inputs?.[input.id];
    if (supplied === undefined) {
      if (input.required) warnings.push(`missing required input "${input.id}"`);
      continue;
    }
    if (input.multiple && !Array.isArray(supplied)) {
      warnings.push(`input "${input.id}" accepts multiple values but a single value was supplied`);
    }
    if (!input.multiple && Array.isArray(supplied)) {
      warnings.push(`input "${input.id}" accepts one value but an array was supplied`);
    }
  }

  // Not arity, but the same shape of evidence and free to collect: an input the
  // description does not declare. ZOO answers one with a 500 that names a
  // different problem entirely, so the client-side note is the only warning
  // anyone will get.
  const declared = new Set(description.inputs.map((input) => input.id));
  for (const id of Object.keys(inputs ?? {})) {
    if (!declared.has(id)) warnings.push(`input "${id}" is not declared by this process`);
  }

  return warnings;
}

/**
 * The request body.
 *
 * `outputs` and `response` appear only when the caller supplied them, per T9.
 * pygeoapi declares `outputTransmission: ["value"]` only, so a helpfully
 * synthesised block asking for `reference` would be a self-inflicted failure —
 * and deciding what a process's outputs should look like is `apps/web`'s call
 * under §7.2, not the core's.
 *
 * That rule held, but step zero made it expensive rather than free: ZOO answers
 * a body carrying **only** `inputs` with `400 InvalidParameterValue`,
 * "ZOO-Kernel cannot parse your POST data: None", and starts working the moment
 * any `outputs` member is present — even `{}`. See finding 0025. Auto-adding
 * one here would have made the demo path green and hidden a defect in a server
 * we were funded to characterise, so the omission stands and the caller
 * supplies `outputs` when it wants ZOO to run. The observation records whether
 * one was sent, so the correlation is visible in the matrix rather than only in
 * a stack trace.
 */
export function buildPayload(options: ExecuteOptions): ExecutePayload {
  return {
    ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    ...(options.outputs === undefined ? {} : { outputs: options.outputs }),
    ...(options.response === undefined ? {} : { response: options.response }),
  };
}

/** Everything above, assembled. */
export function buildRequest(
  processesUrl: string,
  processId: string,
  options: ExecuteOptions,
): ExecuteRequest {
  const { url, route } = resolveExecutionUrl(processesUrl, processId, options.description);
  const payload = buildPayload(options);
  const inputIds = Object.keys(options.inputs ?? {});

  return {
    url,
    route,
    headers: buildHeaders(options.mode ?? "sync"),
    body: JSON.stringify(payload),
    payload,
    warnings: checkArity(options.description, options.inputs),
    inputIds,
    inputKinds: inputIds.map((id) => describeInputKind(options.inputs?.[id])),
  };
}
