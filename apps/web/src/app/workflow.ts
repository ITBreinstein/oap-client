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
 * Stage alone is not enough for that: the same stage can come round again
 * with other content. A description the user asked of one server can arrive
 * after they moved to another and opened a process of the same name there,
 * and a "Load" of one run's output can finish on the next run's result screen
 * (review W4, W5). So every answer to a request says what it was for — the
 * connection it was sent on, or the run it belongs to — and the reducer drops
 * any that does not match what is on screen.
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
  ProtocolVersionPreference,
  ServiceDescription,
} from "@breinstein/oap-client";
import type { FormValues } from "../forms/encode.js";
import type { FormPlan } from "../forms/plan.js";
import type { LoadedReference } from "../results/reference.js";
import type { FormatChoices } from "../results/format-choice.js";
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
      /** The process ids to list, when the configuration names some. Absent: all. */
      readonly processes?: readonly string[] | undefined;
      /** A pin from `config.json`'s preset of this address; see `protocol-version.ts`. */
      readonly protocolVersion?: ProtocolVersionPreference | undefined;
    }
  | {
      readonly source: "typed";
      readonly baseUrl: string;
      readonly protocolVersion?: ProtocolVersionPreference | undefined;
    };

/** Said to the user. What happened, and what to do next (T11). */
export interface WorkflowError {
  readonly title: string;
  readonly detail?: string | undefined;
  /** The input a server's refusal named, when it named one. */
  readonly inputId?: string | undefined;
  /** Not a failure: something the user asked for, reported on the same line. */
  readonly notice?: true | undefined;
  /**
   * What a developer is told about it, in the Developer section: never in
   * the visitor's words (#25).
   */
  readonly technical?: string | undefined;
  /**
   * A direct connection failed the way a missing CORS header fails (or the
   * server is down: a browser can't tell, W34). The relay may read a
   * configured endpoint of the same address (#4).
   */
  readonly corsOrUnreachable?: true | undefined;
}

interface Connected {
  readonly endpoint: EndpointRef;
  /**
   * Which connection this is, counted by the page. A description fetched on
   * another connection, even to the same endpoint, is not this one's.
   */
  readonly connection: number;
  /**
   * How this page reads the server for this connection: `direct`, or through
   * the relay after the user confirmed it. Shown as a banner the whole time.
   */
  readonly route: "direct" | "relay";
  readonly service: ServiceDescription;
  readonly processes: ProcessList;
  /** The process opened last on this connection: the list returns to it. */
  readonly lastOpened?: string | undefined;
  /** The processes run to a result on this connection, each once, in the order first run. */
  readonly ran?: readonly string[] | undefined;
}

interface ProcessOpen extends Connected {
  readonly process: ProcessDescription;
  readonly plan: FormPlan;
  readonly values: FormValues;
  /** The core's parse warnings for this description, shown on the detail screen. */
  readonly warnings: readonly string[];
  readonly mode: ExecutionMode;
  /**
   * The outputs to ask for by reference (Task 8, T2). Empty by default: every
   * output is asked for as the server prefers, as before.
   */
  readonly linkOutputs: readonly string[];
  /**
   * The user's own format choices (#F3), by output id: a media type, or
   * `null` for "let the service choose". An output not here gets the page's
   * own choice, `preferredFormat`.
   */
  readonly formatChoices: FormatChoices;
}

export type AsyncRun = {
  readonly mode: "async";
  readonly jobRef?: string | undefined;
  /**
   * A job this page follows but did not start: opened from a link to it, or
   * from My jobs. Its inputs are not known here.
   */
  readonly watched?: true | undefined;
};
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
      /** The endpoint `error` is about. */
      readonly failed?: EndpointRef | undefined;
      /** An example was chosen: the process to open once connected. */
      readonly openAfter?: string | undefined;
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
  | (ProcessOpen & {
      readonly stage: "running";
      readonly run: Run;
      /** This run's id; every answer to it carries the same one. */
      readonly runId: string;
    })
  | (ProcessOpen & {
      readonly stage: "result";
      /** The run these results are from, so a late "Load" of another run's output is dropped. */
      readonly runId: string;
      readonly results: readonly RenderableResult[];
      /** The job the results came from, for an asynchronous run. */
      readonly jobRef?: string | undefined;
      /** That job was followed, not started here: its inputs are not known. */
      readonly watched?: true | undefined;
    });

export type WorkflowAction =
  | { readonly type: "connect"; readonly endpoint: EndpointRef }
  /** An example: connect to `endpoint`, then open `processId` there. */
  | { readonly type: "open-example"; readonly endpoint: EndpointRef; readonly processId: string }
  | {
      readonly type: "connected";
      readonly endpoint: EndpointRef;
      readonly connection: number;
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
      readonly connection: number;
      readonly process: ProcessDescription;
      readonly plan: FormPlan;
      readonly values: FormValues;
      readonly warnings: readonly string[];
    }
  | {
      readonly type: "process-failed";
      readonly connection: number;
      readonly processId: string;
      readonly error: WorkflowError;
    }
  | { readonly type: "back-to-list" }
  | { readonly type: "set-value"; readonly id: string; readonly value: unknown }
  /** "Clear the form" (#10): every input back to what it started with. */
  | { readonly type: "reset-form"; readonly values: FormValues }
  | { readonly type: "set-mode"; readonly mode: ExecutionMode }
  | {
      readonly type: "set-transmission";
      readonly outputId: string;
      readonly transmission: "value" | "reference";
    }
  /** #F3: ask for this media type for one output, or `null` for none. */
  | { readonly type: "set-format"; readonly outputId: string; readonly mediaType: string | null }
  | { readonly type: "run-started"; readonly runId: string; readonly mode: ExecutionMode }
  | { readonly type: "job-started"; readonly runId: string; readonly jobRef: string }
  /** Follow a job already on the server, from the open process. */
  | { readonly type: "watch-job"; readonly runId: string; readonly jobRef: string }
  | {
      readonly type: "results";
      readonly runId: string;
      readonly results: readonly RenderableResult[];
    }
  /** What "Load" found behind one output given by reference (Task 8, T3). */
  | {
      readonly type: "reference-loaded";
      readonly runId: string;
      readonly outputId: string;
      readonly loaded: LoadedReference;
    }
  | { readonly type: "run-failed"; readonly runId: string; readonly error: WorkflowError }
  /** A word about the form on screen, such as why it is empty (#33). */
  | { readonly type: "form-notice"; readonly processId: string; readonly notice: string }
  | { readonly type: "edit" };

export const INITIAL_WORKFLOW: Workflow = { stage: "choose-endpoint" };

/** T6: sync when the process can, else async. The toggle only exists when both work. */
export function defaultMode(process: ProcessDescription): ExecutionMode {
  return process.execution.sync || !process.execution.async ? "sync" : "async";
}

/**
 * Where an example lands once connected: on its process, or, when the list
 * does not have it, on the list with a notice. A list cut short might hold it
 * further on, so there the description is asked for all the same.
 */
export function exampleLanding(processes: ProcessList, processId: string): "open" | "missing" {
  return processes.truncated || processes.processes.some((process) => process.id === processId)
    ? "open"
    : "missing";
}

/** What the list says when an example names a process the service does not list. */
export function missingProcess(processId: string): WorkflowError {
  return {
    title: `This service has no process called ${processId}.`,
    detail: "The example names a process this service does not list. Choose one from the list.",
    notice: true,
  };
}

function sameEndpoint(a: EndpointRef | undefined, b: EndpointRef): boolean {
  return a !== undefined && a.source === b.source && a.baseUrl === b.baseUrl;
}

function connectedPart(state: Connected): Connected {
  return {
    endpoint: state.endpoint,
    connection: state.connection,
    route: state.route,
    service: state.service,
    processes: state.processes,
    lastOpened: state.lastOpened,
    ran: state.ran,
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
    linkOutputs: state.linkOutputs,
    formatChoices: state.formatChoices,
  };
}

/**
 * Whether the screen may move on from `state` to the list or another
 * process. Not mid-run, where leaving would abandon a run the user has not
 * been told the fate of: except a background job the server has named,
 * which goes on in My jobs and has its own link.
 */
function leavable(
  state: Workflow,
): state is Extract<Workflow, { stage: "process" | "running" | "result" }> {
  return (
    state.stage === "process" ||
    state.stage === "result" ||
    (state.stage === "running" && state.run.mode === "async" && state.run.jobRef !== undefined)
  );
}

export function workflowReducer(state: Workflow, action: WorkflowAction): Workflow {
  switch (action.type) {
    case "connect":
      // Not while the question is open: it must be answered, and recorded.
      return state.stage === "choose-endpoint" && state.offer === undefined
        ? { stage: "choose-endpoint", connecting: action.endpoint }
        : state;

    case "open-example":
      // A connect that remembers which process to open. From the start
      // screen, or from anywhere connected — never mid-run (but a background
      // job: `leavable`), nor while the relay question is open.
      return (state.stage === "choose-endpoint" && state.offer === undefined) ||
        state.stage === "connected" ||
        leavable(state)
        ? { stage: "choose-endpoint", connecting: action.endpoint, openAfter: action.processId }
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
            connection: action.connection,
            route: action.route,
            service: action.service,
            processes: action.processes,
            // An example's process: opened at once, or a notice that it is not there.
            ...(state.openAfter === undefined
              ? {}
              : exampleLanding(action.processes, state.openAfter) === "open"
                ? { opening: state.openAfter, lastOpened: state.openAfter }
                : { error: missingProcess(state.openAfter) }),
          }
        : state;

    case "connect-failed":
      return state.stage === "choose-endpoint" && sameEndpoint(state.connecting, action.endpoint)
        ? { stage: "choose-endpoint", error: action.error, failed: action.endpoint }
        : state;

    case "relay-offered":
      return state.stage === "choose-endpoint" &&
        state.viaRelay !== true &&
        sameEndpoint(state.connecting, action.endpoint)
        ? {
            stage: "choose-endpoint",
            offer: { endpoint: action.endpoint, error: action.error },
            openAfter: state.openAfter,
          }
        : state;

    case "relay-confirmed":
      return state.stage === "choose-endpoint" && state.offer !== undefined
        ? {
            stage: "choose-endpoint",
            connecting: state.offer.endpoint,
            viaRelay: true,
            openAfter: state.openAfter,
          }
        : state;

    case "relay-declined":
      return state.stage === "choose-endpoint" && state.offer !== undefined
        ? { stage: "choose-endpoint", error: state.offer.error }
        : state;

    case "disconnect":
      return state.stage === "choose-endpoint" ? state : INITIAL_WORKFLOW;

    case "open-process":
      // From the list, from a form, or from a result — never mid-run, where
      // leaving would abandon a job the user has not been told the fate of
      // (but a background job: `leavable`).
      return state.stage === "connected" || leavable(state)
        ? {
            stage: "connected",
            ...connectedPart(state),
            opening: action.processId,
            lastOpened: action.processId,
          }
        : state;

    case "process-loaded":
      // A fresh plan, and the values this process's form was left with this
      // visit, or its starting values (#10; `form-memory.ts`): never another
      // process's. Reduction test (c).
      return state.stage === "connected" &&
        state.connection === action.connection &&
        state.opening === action.process.id
        ? {
            stage: "process",
            ...connectedPart(state),
            process: action.process,
            plan: action.plan,
            values: action.values,
            warnings: action.warnings,
            mode: defaultMode(action.process),
            linkOutputs: [],
            formatChoices: {},
          }
        : state;

    case "process-failed":
      return state.stage === "connected" &&
        state.connection === action.connection &&
        state.opening === action.processId
        ? { stage: "connected", ...connectedPart(state), error: action.error }
        : state;

    case "back-to-list":
      return leavable(state) ? { stage: "connected", ...connectedPart(state) } : state;

    case "set-value":
      return state.stage === "process"
        ? {
            ...state,
            // A changed input is no longer the one the service's error named:
            // its mark goes, as the form's own does (#11). The words stay.
            error:
              state.error?.inputId === action.id
                ? { ...state.error, inputId: undefined }
                : state.error,
            // A Map would be safer for ids like "__proto__"; `fromEntries`
            // defines own properties, which is what the encoder reads (N5).
            values: Object.fromEntries([
              ...Object.entries(state.values).filter(([id]) => id !== action.id),
              [action.id, action.value],
            ]),
          }
        : state;

    case "reset-form":
      // The last run's error was about the values that are gone.
      return state.stage === "process"
        ? { ...state, values: action.values, error: undefined }
        : state;

    case "set-mode":
      return state.stage === "process" ? { ...state, mode: action.mode } : state;

    case "set-transmission":
      return state.stage === "process" &&
        state.process.outputs.some((output) => output.id === action.outputId)
        ? {
            ...state,
            linkOutputs: [
              ...state.linkOutputs.filter((id) => id !== action.outputId),
              ...(action.transmission === "reference" ? [action.outputId] : []),
            ],
          }
        : state;

    case "set-format":
      return state.stage === "process" &&
        state.process.outputs.some((output) => output.id === action.outputId)
        ? {
            ...state,
            formatChoices: { ...state.formatChoices, [action.outputId]: action.mediaType },
          }
        : state;

    case "run-started":
      return state.stage === "process"
        ? {
            stage: "running",
            ...openPart(state),
            run: action.mode === "sync" ? { mode: "sync" } : { mode: "async" },
            runId: action.runId,
          }
        : state;

    case "watch-job":
      return state.stage === "process"
        ? {
            stage: "running",
            ...openPart(state),
            run: { mode: "async", jobRef: action.jobRef, watched: true },
            runId: action.runId,
          }
        : state;

    case "job-started":
      // A synchronous request the server answered with a job becomes an
      // asynchronous run: the server decides, and the screen follows.
      return state.stage === "running" &&
        state.runId === action.runId &&
        (state.run.mode === "sync" || state.run.jobRef === undefined)
        ? { ...state, run: { mode: "async", jobRef: action.jobRef } }
        : state;

    case "results":
      return state.stage === "running" && state.runId === action.runId
        ? {
            stage: "result",
            ...openPart(state),
            ran: (state.ran ?? []).includes(state.process.id)
              ? state.ran
              : [...(state.ran ?? []), state.process.id],
            runId: state.runId,
            results: action.results,
            jobRef: state.run.mode === "async" ? state.run.jobRef : undefined,
            watched: state.run.mode === "async" ? state.run.watched : undefined,
          }
        : state;

    case "run-failed":
      return state.stage === "running" && state.runId === action.runId
        ? { stage: "process", ...openPart(state), error: action.error }
        : state;

    case "form-notice":
      // Only onto the form of the process it was meant for.
      return state.stage === "process" && state.process.id === action.processId
        ? { ...state, error: { title: action.notice, notice: true } }
        : state;

    case "reference-loaded":
      // Only onto the output it was loaded for, and only while that run's
      // result is still the one on screen (Task 8, T8; review W5).
      return state.stage === "result" &&
        state.runId === action.runId &&
        state.results.some(
          (result) => result.kind === "reference" && result.outputId === action.outputId,
        )
        ? {
            ...state,
            results: state.results.map((result) =>
              result.kind === "reference" && result.outputId === action.outputId
                ? { ...result, loaded: action.loaded }
                : result,
            ),
          }
        : state;

    case "edit":
      return state.stage === "result" ? { stage: "process", ...openPart(state) } : state;
  }
}
