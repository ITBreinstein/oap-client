/**
 * The workflow, as one reducer (T7): connect, choose, fill in, run, see the
 * result.
 *
 * Every stage is an arm of one discriminated union, and a stage changes only
 * through an action here. An action that makes no sense in the current stage
 * — a result arriving for a run that is not running, say — is ignored: the
 * reducer hands back the state it was given, the same object, and a test pins
 * that. It is how a late answer from an abandoned request cannot overwrite the
 * screen the user has since moved to.
 *
 * What is *not* here: a job's status. For an asynchronous run the reducer holds
 * the job's reference, its status URL, and nothing else. Status is owned by
 * the `JobReconciler`, the single writer since Task 6, and the screen reads it
 * from the session's snapshot. Two writers of one job's state is the bug that
 * rule exists to prevent.
 */

import type {
  ExecutionMode,
  ProcessDescription,
  ProcessList,
  ServiceDescription,
} from "@breinstein/oap-client";
import type { FormValues } from "../forms/encode.js";
import type { FormPlan } from "../forms/plan.js";
import type { RenderableResult } from "../results/renderable.js";

/**
 * Where an endpoint came from, which decides whether the relay may carry its
 * executes (T8). A typed URL is always direct: the relay only accepts the keys
 * it was configured with.
 */
export type EndpointRef =
  | {
      readonly source: "configured";
      readonly key: string;
      readonly baseUrl: string;
      readonly executeRoute: "direct" | "relay";
      /** Whether the relay may carry this endpoint's reads, once the user confirmed. */
      readonly readRoute: "direct" | "relay";
      readonly callbacks: boolean;
    }
  | { readonly source: "typed"; readonly baseUrl: string };

/** Said to the user. What happened, and what to do next (T11). */
export interface WorkflowError {
  readonly title: string;
  readonly detail?: string | undefined;
  /** The input a server's refusal named, when it named one. */
  readonly inputId?: string | undefined;
  /** Not a failure: something the user asked for, reported on the same line. */
  readonly notice?: true | undefined;
}

interface Connected {
  readonly endpoint: EndpointRef;
  /**
   * How this page reads the server for this connection: `direct`, or through
   * the relay after the user confirmed it. Shown as a banner the whole time.
   */
  readonly route: "direct" | "relay";
  readonly service: ServiceDescription;
  readonly processes: ProcessList;
}

interface ProcessOpen extends Connected {
  readonly process: ProcessDescription;
  readonly plan: FormPlan;
  readonly values: FormValues;
  /** The core's parse warnings for this description, shown on the detail screen. */
  readonly warnings: readonly string[];
  readonly mode: ExecutionMode;
}

export type AsyncRun = { readonly mode: "async"; readonly jobRef?: string | undefined };
export type Run = { readonly mode: "sync" } | AsyncRun;

export type Workflow =
  | {
      readonly stage: "choose-endpoint";
      readonly connecting?: EndpointRef | undefined;
      /** Set while an attempt through the relay, confirmed by the user, is under way. */
      readonly viaRelay?: true | undefined;
      /**
       * The direct attempt failed as CORS does, and the relay offers this
       * endpoint its read route: the question is on screen. Only the user's
       * answer leaves this state.
       */
      readonly offer?:
        { readonly endpoint: EndpointRef; readonly error: WorkflowError } | undefined;
      readonly error?: WorkflowError | undefined;
    }
  | (Connected & {
      readonly stage: "connected";
      /** A description being fetched. */
      readonly opening?: string | undefined;
      readonly error?: WorkflowError | undefined;
    })
  | (ProcessOpen & {
      readonly stage: "process";
      /** Why the last run did not produce a result. */
      readonly error?: WorkflowError | undefined;
    })
  | (ProcessOpen & { readonly stage: "running"; readonly run: Run })
  | (ProcessOpen & {
      readonly stage: "result";
      readonly results: readonly RenderableResult[];
      /** The job the results came from, for an asynchronous run. */
      readonly jobRef?: string | undefined;
    });

export type WorkflowAction =
  | { readonly type: "connect"; readonly endpoint: EndpointRef }
  | {
      readonly type: "connected";
      readonly endpoint: EndpointRef;
      readonly route: "direct" | "relay";
      readonly service: ServiceDescription;
      readonly processes: ProcessList;
    }
  | {
      readonly type: "relay-offered";
      readonly endpoint: EndpointRef;
      readonly error: WorkflowError;
    }
  | { readonly type: "relay-confirmed" }
  | { readonly type: "relay-declined" }
  | {
      readonly type: "connect-failed";
      readonly endpoint: EndpointRef;
      readonly error: WorkflowError;
    }
  | { readonly type: "disconnect" }
  | { readonly type: "open-process"; readonly processId: string }
  | {
      readonly type: "process-loaded";
      readonly process: ProcessDescription;
      readonly plan: FormPlan;
      readonly values: FormValues;
      readonly warnings: readonly string[];
    }
  | { readonly type: "process-failed"; readonly processId: string; readonly error: WorkflowError }
  | { readonly type: "back-to-list" }
  | { readonly type: "set-value"; readonly id: string; readonly value: unknown }
  | { readonly type: "set-mode"; readonly mode: ExecutionMode }
  | { readonly type: "run-started"; readonly mode: ExecutionMode }
  | { readonly type: "job-started"; readonly jobRef: string }
  | { readonly type: "results"; readonly results: readonly RenderableResult[] }
  | { readonly type: "run-failed"; readonly error: WorkflowError }
  | { readonly type: "edit" };

export const INITIAL_WORKFLOW: Workflow = { stage: "choose-endpoint" };

/** T6: sync when the process can, else async. The toggle only exists when both work. */
export function defaultMode(process: ProcessDescription): ExecutionMode {
  return process.execution.sync || !process.execution.async ? "sync" : "async";
}

function sameEndpoint(a: EndpointRef | undefined, b: EndpointRef): boolean {
  return a !== undefined && a.source === b.source && a.baseUrl === b.baseUrl;
}

function connectedPart(state: Connected): Connected {
  return {
    endpoint: state.endpoint,
    route: state.route,
    service: state.service,
    processes: state.processes,
  };
}

function openPart(state: ProcessOpen): ProcessOpen {
  return {
    ...connectedPart(state),
    process: state.process,
    plan: state.plan,
    values: state.values,
    warnings: state.warnings,
    mode: state.mode,
  };
}

export function workflowReducer(state: Workflow, action: WorkflowAction): Workflow {
  switch (action.type) {
    case "connect":
      // Not while the question is open: it must be answered, and recorded.
      return state.stage === "choose-endpoint" && state.offer === undefined
        ? { stage: "choose-endpoint", connecting: action.endpoint }
        : state;

    case "connected":
      // The relay route only after "Use relay"; a direct answer only to a
      // direct attempt. A late answer from the other route is ignored.
      return state.stage === "choose-endpoint" &&
        sameEndpoint(state.connecting, action.endpoint) &&
        (action.route === "relay") === (state.viaRelay === true)
        ? {
            stage: "connected",
            endpoint: action.endpoint,
            route: action.route,
            service: action.service,
            processes: action.processes,
          }
        : state;

    case "connect-failed":
      return state.stage === "choose-endpoint" && sameEndpoint(state.connecting, action.endpoint)
        ? { stage: "choose-endpoint", error: action.error }
        : state;

    case "relay-offered":
      return state.stage === "choose-endpoint" &&
        state.viaRelay !== true &&
        sameEndpoint(state.connecting, action.endpoint)
        ? { stage: "choose-endpoint", offer: { endpoint: action.endpoint, error: action.error } }
        : state;

    case "relay-confirmed":
      return state.stage === "choose-endpoint" && state.offer !== undefined
        ? { stage: "choose-endpoint", connecting: state.offer.endpoint, viaRelay: true }
        : state;

    case "relay-declined":
      return state.stage === "choose-endpoint" && state.offer !== undefined
        ? { stage: "choose-endpoint", error: state.offer.error }
        : state;

    case "disconnect":
      return state.stage === "choose-endpoint" ? state : INITIAL_WORKFLOW;

    case "open-process":
      // From the list, from a form, or from a result — never mid-run, where
      // leaving would abandon a job the user has not been told the fate of.
      return state.stage === "connected" || state.stage === "process" || state.stage === "result"
        ? { stage: "connected", ...connectedPart(state), opening: action.processId }
        : state;

    case "process-loaded":
      // A fresh plan and fresh values, always: nothing of the previous
      // process's form survives into this one. Reduction test (c).
      return state.stage === "connected" && state.opening === action.process.id
        ? {
            stage: "process",
            ...connectedPart(state),
            process: action.process,
            plan: action.plan,
            values: action.values,
            warnings: action.warnings,
            mode: defaultMode(action.process),
          }
        : state;

    case "process-failed":
      return state.stage === "connected" && state.opening === action.processId
        ? { stage: "connected", ...connectedPart(state), error: action.error }
        : state;

    case "back-to-list":
      return state.stage === "process" || state.stage === "result"
        ? { stage: "connected", ...connectedPart(state) }
        : state;

    case "set-value":
      return state.stage === "process"
        ? {
            ...state,
            // A Map would be safer for ids like "__proto__"; `fromEntries`
            // defines own properties, which is what the encoder reads (N5).
            values: Object.fromEntries([
              ...Object.entries(state.values).filter(([id]) => id !== action.id),
              [action.id, action.value],
            ]),
          }
        : state;

    case "set-mode":
      return state.stage === "process" ? { ...state, mode: action.mode } : state;

    case "run-started":
      return state.stage === "process"
        ? {
            stage: "running",
            ...openPart(state),
            run: action.mode === "sync" ? { mode: "sync" } : { mode: "async" },
          }
        : state;

    case "job-started":
      // A synchronous request the server answered with a job becomes an
      // asynchronous run: the server decides, and the screen follows.
      return state.stage === "running" &&
        (state.run.mode === "sync" || state.run.jobRef === undefined)
        ? { ...state, run: { mode: "async", jobRef: action.jobRef } }
        : state;

    case "results":
      return state.stage === "running"
        ? {
            stage: "result",
            ...openPart(state),
            results: action.results,
            jobRef: state.run.mode === "async" ? state.run.jobRef : undefined,
          }
        : state;

    case "run-failed":
      return state.stage === "running"
        ? { stage: "process", ...openPart(state), error: action.error }
        : state;

    case "edit":
      return state.stage === "result" ? { stage: "process", ...openPart(state) } : state;
  }
}
