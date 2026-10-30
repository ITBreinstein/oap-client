/**
 * What goes into one run, decided without touching the network — so every
 * decision here is a unit test, as `build-request.ts` does for the core.
 */

import {
  BodyTooLargeError,
  DraftUnsupportedRequestError,
  isAbsoluteUrl,
  ProcessesError,
  type ExecuteOutputSelection,
  type ProcessDescription,
} from "@breinstein/oap-client";
import { toExecuteBody, type EncodeNote, type FormValues } from "../forms/encode.js";
import type { FieldPlan, FormPlan } from "../forms/plan.js";
import type { EndpointRef, WorkflowError } from "./workflow.js";
import type { RelayEndpoint } from "../relay/contract.js";
import { relayRateLimitIn } from "../relay/relay-fetch.js";

/**
 * Every declared output, with no format and no transmission mode: the
 * standard's way of asking for all of them as the server prefers (R8).
 *
 * Sent because the core deliberately does not synthesise `outputs` — that
 * would hide finding 0025, ZOO refusing a body without one — and the web app,
 * unlike the core, knows the description. This is not a workaround: it is the
 * same request a client that let the user pick outputs would send with every
 * box ticked, and the execution observation still records that `outputs` was
 * supplied, so 0025 stays visible in the matrix.
 *
 * An output in `linkOutputs` is asked for by reference (Task 8, T2); the rest
 * stay as the server prefers, exactly as before.
 */
export function outputSelection(
  process: ProcessDescription,
  linkOutputs: readonly string[] = [],
): Record<string, ExecuteOutputSelection> {
  return Object.fromEntries(
    process.outputs.map((output) => [
      output.id,
      linkOutputs.includes(output.id) ? { transmissionMode: "reference" } : {},
    ]),
  );
}

/**
 * Task 8, T2: whether the description allows asking for an output by
 * reference. Process level only: 1.0 has no per-output declaration, and
 * neither server sends one.
 */
export function offersLink(process: ProcessDescription): boolean {
  return process.outputTransmission.includes("reference");
}

/** Each output's declared `contentMediaType`, for the result screen. */
export function declaredMediaTypes(
  process: ProcessDescription,
): Record<string, string | undefined> {
  return Object.fromEntries(
    process.outputs.map((output) => {
      const mediaType = output.schema["contentMediaType"];
      return [output.id, typeof mediaType === "string" ? mediaType : undefined];
    }),
  );
}

export interface RunRequest {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, ExecuteOutputSelection>>;
  readonly notes: readonly EncodeNote[];
}

export function runRequest(
  process: ProcessDescription,
  plan: FormPlan,
  values: FormValues,
  linkOutputs: readonly string[] = [],
): RunRequest {
  const { inputs, notes } = toExecuteBody(plan, values);
  return { inputs, outputs: outputSelection(process, linkOutputs), notes };
}

/** The relay's view of an endpoint. A typed URL is always direct (T8). */
export function relayEndpointFor(endpoint: EndpointRef): RelayEndpoint {
  const pinned =
    endpoint.protocolVersion === undefined ? {} : { protocolVersion: endpoint.protocolVersion };
  return endpoint.source === "configured"
    ? {
        key: endpoint.key,
        baseUrl: endpoint.baseUrl,
        executeRoute: endpoint.executeRoute,
        readRoute: endpoint.readRoute,
        callbacks: endpoint.callbacks,
        ...pinned,
      }
    : {
        key: "typed",
        baseUrl: endpoint.baseUrl,
        executeRoute: "direct",
        readRoute: "direct",
        callbacks: false,
        ...pinned,
      };
}

/** A typed address, tidied: trimmed, trailing slashes dropped. Undefined if it is no URL. */
export function typedEndpoint(text: string): EndpointRef | undefined {
  const trimmed = text.trim().replace(/\/+$/, "");
  if (!isAbsoluteUrl(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return { source: "typed", baseUrl: trimmed };
}

/**
 * The relay's rate limit, wherever a request through it was refused for one:
 * how long to wait, and whose limit it was. `undefined` for any other failure.
 */
export function rateLimitMessage(cause: unknown): WorkflowError | undefined {
  const limited = relayRateLimitIn(cause);
  if (limited === undefined) return undefined;
  const seconds = limited.retryAfterSeconds;
  const when =
    seconds === undefined
      ? "Try again shortly."
      : `Try again in ${String(seconds)} ${seconds === 1 ? "second" : "seconds"}.`;
  return {
    title: `Too many requests through the relay. ${when}`,
    detail:
      limited.code === "rate-limited-endpoint"
        ? "This service has had as many requests through the relay as it may take for now, from everyone using it. (rate-limited-endpoint)"
        : "This page, or others sharing its network address, sent more requests through the relay than it allows for now. (rate-limited)",
  };
}

/**
 * The input a service's words name, when they name one of the form's by its
 * id, quoted or in angle brackets: `"area"`, `'area'`, `` `area` ``, `<area>`.
 */
export function namedInput(words: string | undefined, plan: FormPlan): FieldPlan | undefined {
  if (words === undefined) return undefined;
  return plan.fields.find((field) => new RegExp(`["'\`<]${escape(field.id)}["'\`>]`).test(words));
}

/**
 * What the form says when the service reported an error (#23): that it did,
 * and to check an input only when the service's own words name one, by the
 * label the form shows it under. Nothing else: a process that fails while
 * running is answered with a 400 too (pygeoapi), and is no fault of the
 * inputs.
 */
export function serviceErrorTitle(inputLabel: string | undefined): string {
  return inputLabel === undefined
    ? "The service reported an error."
    : `The service reported an error. Check the input “${inputLabel}” and run again.`;
}

/** The service's error, its own words as the detail, and the input they name. */
export function serviceError(words: string | undefined, plan: FormPlan): WorkflowError {
  const named = namedInput(words, plan);
  return { title: serviceErrorTitle(named?.title), detail: words, inputId: named?.id };
}

/**
 * The input a service's error names, as the form marks one of its own
 * (#11): that input in error, with the service's words under it. Nothing
 * when it names none.
 */
export function namedFieldError(error: WorkflowError | undefined): ReadonlyMap<string, string> {
  if (error?.inputId === undefined) return new Map();
  return new Map([[error.inputId, error.detail ?? "The service named this input in its error."]]);
}

/**
 * A server's refusal, as the form shows it (T5): its own `detail`, and the
 * input it names when its words name one we know. The relay's rate limit
 * first: then the server never saw the request.
 */
export function runError(cause: unknown, plan: FormPlan): WorkflowError {
  const limited = rateLimitMessage(cause);
  if (limited !== undefined) return limited;
  if (cause instanceof ProcessesError) {
    const problem = cause.problem;
    const extensions = problem?.extensions ?? {};
    const description = extensions["description"];
    const detail =
      problem?.detail ??
      (typeof description === "string" ? description : undefined) ??
      problem?.title ??
      cause.bodyPreview;
    return serviceError(detail, plan);
  }
  if (cause instanceof DraftUnsupportedRequestError) {
    // Refused by the core before anything was sent: nothing ran, and no job
    // exists. The core's words say which request, and why.
    return {
      title: "Not sent: this service's version of the standard can't express this request.",
      detail: cause.message,
    };
  }
  if (cause instanceof BodyTooLargeError) {
    // The run finished; its answer is more than this page reads. Not "did not
    // complete", which would send the user back to run it again.
    const megabytes = (cause.limit / (1024 * 1024)).toFixed(0);
    return {
      title: `The run finished, but its result is larger than the ${megabytes} MB this page reads.`,
      detail: cause.message,
    };
  }
  return {
    title: "The request did not complete.",
    detail: cause instanceof Error ? cause.message : String(cause),
  };
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
