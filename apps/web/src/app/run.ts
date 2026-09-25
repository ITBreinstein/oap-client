/**
 * What goes into one run, decided without touching the network — so every
 * decision here is a unit test, as `build-request.ts` does for the core.
 */

import {
  isAbsoluteUrl,
  ProcessesError,
  type ExecuteOutputSelection,
  type ProcessDescription,
  type ProcessList,
} from "@breinstein/oap-client";
import { toExecuteBody, type EncodeNote, type FormValues } from "../forms/encode.js";
import type { FormPlan } from "../forms/plan.js";
import type { EndpointRef, ListFilter, WorkflowError } from "./workflow.js";
import type { RelayEndpoint } from "../relay/contract.js";

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
 */
export function outputSelection(
  process: ProcessDescription,
): Record<string, ExecuteOutputSelection> {
  return Object.fromEntries(process.outputs.map((output) => [output.id, {}]));
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
): RunRequest {
  const { inputs, notes } = toExecuteBody(plan, values);
  return { inputs, outputs: outputSelection(process), notes };
}

/** The relay's view of an endpoint. A typed URL is always direct (T8). */
export function relayEndpointFor(endpoint: EndpointRef): RelayEndpoint {
  return endpoint.source === "configured"
    ? {
        key: endpoint.key,
        baseUrl: endpoint.baseUrl,
        executeRoute: endpoint.executeRoute,
        readRoute: endpoint.readRoute,
        callbacks: endpoint.callbacks,
        processes: endpoint.processes,
      }
    : {
        key: "typed",
        baseUrl: endpoint.baseUrl,
        executeRoute: "direct",
        readRoute: "direct",
        callbacks: false,
      };
}

/**
 * The list the page shows. For a configured endpoint that names its processes,
 * only those, in the server's order, and a note of what was left out, so the
 * screen can say so. Anything else is shown whole. So is the list when none of
 * the configured ids was read, rather than leaving the page with nothing to open.
 */
export function listedProcesses(
  endpoint: EndpointRef,
  list: ProcessList,
): { readonly processes: ProcessList; readonly listFilter: ListFilter | undefined } {
  if (endpoint.source !== "configured" || endpoint.processes === undefined) {
    return { processes: list, listFilter: undefined };
  }
  const wanted = new Set(endpoint.processes);
  const kept = list.processes.filter((summary) => wanted.has(summary.id));
  const present = new Set(list.processes.map((summary) => summary.id));
  const applied = kept.length > 0;
  return {
    processes: applied ? { ...list, processes: kept } : list,
    listFilter: {
      read: list.processes.length,
      missing: endpoint.processes.filter((id) => !present.has(id)),
      applied,
    },
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
 * A server's refusal, as the form shows it (T5): its own `detail`, and the
 * input it names when its words name one we know.
 */
export function runError(cause: unknown, plan: FormPlan): WorkflowError {
  if (cause instanceof ProcessesError) {
    const problem = cause.problem;
    const extensions = problem?.extensions ?? {};
    const description = extensions["description"];
    const detail =
      problem?.detail ??
      (typeof description === "string" ? description : undefined) ??
      problem?.title ??
      cause.bodyPreview;
    const named = plan.fields.find(
      (field) =>
        detail !== undefined && new RegExp(`["'\`<]${escape(field.id)}["'\`>]`).test(detail),
    );
    return {
      title: `The server refused the request (HTTP ${String(cause.status)}). Check the inputs and run again.`,
      detail,
      inputId: named?.id,
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
