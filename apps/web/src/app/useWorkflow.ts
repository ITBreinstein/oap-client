/**
 * The workflow's side effects: the network calls behind each stage, and the
 * observations they leave. The reducer decides what the screen shows; this
 * decides when to ask a server, and reports what came back as actions.
 *
 * One `JobSession` per page, as before: it owns the relay, the doorbells, the
 * reconciler and the observation stream. The session's client carries every
 * request but an asynchronous execute, so the whole flow reports into one
 * place, and the export button writes one file.
 */

import {
  AmbiguousExecutionResponseError,
  redactUrl,
  type Client,
  type ExecutionMode,
  type ProcessSummary,
} from "@breinstein/oap-client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { drawableCrs } from "../forms/crs.js";
import { initialValues } from "../forms/defaults.js";
import type { BboxControl, Control, FormPlan } from "../forms/plan.js";
import { resolveFormPlan } from "../forms/resolve.js";
import { validateForm, type FieldErrors } from "../forms/validate.js";
import { formObservationsFor, type FormObservation } from "../observations.js";
import type { RelayEndpoint } from "../relay/contract.js";
import {
  createJobSession,
  type JobSession,
  type JobSessionSnapshot,
  type Reads,
} from "../relay/job-session.js";
import {
  accessRecord,
  directFailure,
  errorName,
  offersRelay,
  relayAttempt,
  type AttemptFacts,
  type RelayAttempt,
} from "./route-decision.js";
import { toRenderable } from "../results/renderable.js";
import {
  declaredMediaTypes,
  listedProcesses,
  relayEndpointFor,
  runError,
  runRequest,
} from "./run.js";
import {
  INITIAL_WORKFLOW,
  workflowReducer,
  type EndpointRef,
  type Workflow,
  type WorkflowError,
} from "./workflow.js";

/** Properties, not methods: each is handed to a component on its own. */
export interface WorkflowCommands {
  readonly connect: (endpoint: EndpointRef) => void;
  /** "Use relay": the only way anything is sent through the relay's read route. */
  readonly confirmRelay: () => void;
  /** "Cancel", Escape, or any other way of closing the question. */
  readonly declineRelay: () => void;
  readonly disconnect: () => void;
  readonly openProcess: (summary: ProcessSummary) => void;
  readonly backToList: () => void;
  readonly setValue: (id: string, value: unknown) => void;
  readonly setMode: (mode: ExecutionMode) => void;
  readonly run: () => void;
  readonly cancelJob: () => void;
  readonly edit: () => void;
}

export interface WorkflowView {
  readonly state: Workflow;
  readonly commands: WorkflowCommands;
  readonly snapshot: JobSessionSnapshot | undefined;
  /** From the relay's `GET /endpoints`; empty without a relay. */
  readonly configured: readonly RelayEndpoint[];
  readonly configuredError: string | undefined;
  readonly fieldErrors: FieldErrors;
  /** A message about the running job that is not a stage change, e.g. a refused cancel. */
  readonly jobNotice: string | undefined;
  /** Whether Cancel job was advertised, and by whom (T6). */
  readonly dismissAdvertisedBy: "process" | "service" | "observed-earlier" | "nothing";
}

const NO_ERRORS: FieldErrors = new Map();

function transportMessage(cause: unknown, endpoint: EndpointRef): WorkflowError {
  if (directFailure(cause) === "cors-blocked") {
    // What to do next depends on where the address came from, and on whether
    // the relay may read this server (findings 0049, 0050).
    const next =
      endpoint.source !== "configured"
        ? "Choose another service, or ask this server's operator to enable CORS."
        : endpoint.readRoute === "relay"
          ? "Connect again to be offered the relay, choose another service, or ask this server's operator to enable CORS."
          : "The relay is not set up to read this service for a web page, so it cannot help here. Choose another service, or ask this server's operator to enable CORS.";
    return {
      title:
        "This server doesn't allow access from a web page (no CORS headers). The attempt has been recorded.",
      detail: `A browser may only read another site's answers when that site sends Access-Control-Allow-Origin. ${next}`,
    };
  }
  return {
    title: "Could not connect to this server. Check the address and try again.",
    detail: cause instanceof Error ? cause.message : String(cause),
  };
}

/** Why the relay attempt did not connect, in words that do not overclaim. */
function relayFailureMessage(attempt: RelayAttempt, cause: unknown): WorkflowError {
  const code = attempt.relayReasonCode;
  switch (attempt.relayOutcome) {
    case "relay-unreachable":
      return {
        title: "The relay did not answer, so this server could not be reached through it either.",
        detail: `Check that the relay is running, then connect again. (${code ?? "unreachable"})`,
      };
    case "relay-refused":
      return {
        title: "The relay refused to read this server.",
        detail: `The relay said: ${code ?? "refused"}.`,
      };
    case "upstream-failed":
      return code === "blocked-address"
        ? {
            title: "The relay is not allowed to reach this server's address.",
            detail: "That is the relay's configuration, not the server. (blocked-address)",
          }
        : {
            title: "The relay could not get an answer from this server. It may be down.",
            detail: `(${code ?? "upstream-failed"})`,
          };
    case "other-failure":
    case "ok":
      return {
        title: "The relay reached this server, but its answer could not be used.",
        detail: cause instanceof Error ? cause.message : String(cause),
      };
  }
}

/** Bbox inputs whose CRSs a map-drawn box cannot be sent in (T9). */
function projectedOnly(plan: FormPlan): { inputId: string; crs: string }[] {
  const leaf = (control: Control): Control =>
    control.kind === "list" ? leaf(control.item) : control;
  return plan.fields.flatMap((field) => {
    const control = leaf(field.control);
    if (control.kind !== "bbox") return [];
    const bbox: BboxControl = control;
    return drawableCrs(bbox.crs) === undefined ? [{ inputId: field.id, crs: bbox.defaultCrs }] : [];
  });
}

export function useWorkflow(relayUrl: string | undefined): WorkflowView {
  const [state, dispatch] = useReducer(workflowReducer, INITIAL_WORKFLOW);
  const [snapshot, setSnapshot] = useState<JobSessionSnapshot | undefined>();
  const [configured, setConfigured] = useState<RelayEndpoint[]>([]);
  const [configuredError, setConfiguredError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_ERRORS);
  const [jobNotice, setJobNotice] = useState<string | undefined>();

  // Made inside the effect, for the reason AsyncJobPanel gives: StrictMode
  // runs effects twice, and a memoised session would be disposed and reused.
  const session = useRef<JobSession | undefined>(undefined);
  const client = useRef<
    { readonly endpoint: EndpointRef; readonly client: Client; readonly reads: Reads } | undefined
  >(undefined);
  /** The direct attempt behind an open offer, for the record its answer completes. */
  const pendingOffer = useRef<AttemptFacts | undefined>(undefined);
  const relayAvailable = relayUrl !== undefined && relayUrl !== "";
  /** Endpoints where a dismissal has been seen to work this session (T6). */
  const [dismissWorked, setDismissWorked] = useState<ReadonlySet<string>>(() => new Set());
  /** Form observations already recorded, so reopening a process does not repeat them. */
  const recorded = useRef(new Set<string>());
  /** The job whose results are being fetched, so a snapshot burst fetches once. */
  const fetching = useRef<string | undefined>(undefined);

  useEffect(() => {
    const created = createJobSession(relayUrl);
    session.current = created;
    const unsubscribe = created.subscribe(setSnapshot);
    let live = true;
    if (relayUrl !== undefined && relayUrl !== "") {
      created
        .endpoints()
        .then((list) => {
          if (live) setConfigured(list);
        })
        .catch(() => {
          if (live) {
            setConfiguredError(
              "The relay did not list its endpoints. Type a server's address instead.",
            );
          }
        });
    }
    return () => {
      live = false;
      unsubscribe();
      created.dispose();
      if (session.current === created) session.current = undefined;
    };
  }, [relayUrl]);

  const record = useCallback((observations: readonly FormObservation[]) => {
    for (const observation of observations) {
      const key = JSON.stringify(observation);
      if (recorded.current.has(key)) continue;
      recorded.current.add(key);
      session.current?.record(observation);
    }
  }, []);

  // Direct first, always (route-decision.ts). The relay is offered only for a
  // CORS-shaped failure on an endpoint that allows it, and tried only from
  // confirmRelay. The attempt's one record is written when it settles.
  const connect = useCallback(
    (endpoint: EndpointRef) => {
      const active = session.current;
      if (active === undefined) return;
      dispatch({ type: "connect", endpoint });
      pendingOffer.current = undefined;
      const at = new Date();
      const connection = active.client(relayEndpointFor(endpoint), "direct");
      void (async () => {
        try {
          const service = await connection.inspect();
          const listed = listedProcesses(endpoint, await connection.listProcesses());
          client.current = { endpoint, client: connection, reads: "direct" };
          active.record(
            accessRecord({
              endpoint,
              at,
              relayAvailable,
              direct: "connected",
              directError: undefined,
            }),
          );
          dispatch({ type: "connected", endpoint, route: "direct", service, ...listed });
        } catch (cause) {
          const direct = directFailure(cause);
          const facts = { endpoint, at, relayAvailable, direct, directError: errorName(cause) };
          const error = transportMessage(cause, endpoint);
          if (offersRelay(endpoint, direct, relayAvailable)) {
            pendingOffer.current = facts;
            dispatch({ type: "relay-offered", endpoint, error });
            return;
          }
          active.record(accessRecord(facts));
          dispatch({ type: "connect-failed", endpoint, error });
        }
      })();
    },
    [relayAvailable],
  );

  const confirmRelay = useCallback(() => {
    const active = session.current;
    const facts = pendingOffer.current;
    pendingOffer.current = undefined;
    if (active === undefined || facts === undefined) return;
    const { endpoint } = facts;
    dispatch({ type: "relay-confirmed" });
    const connection = active.client(relayEndpointFor(endpoint), "relay");
    void (async () => {
      try {
        const service = await connection.inspect();
        const listed = listedProcesses(endpoint, await connection.listProcesses());
        client.current = { endpoint, client: connection, reads: "relay" };
        active.record(accessRecord({ ...facts, confirmed: true, relay: relayAttempt(undefined) }));
        dispatch({ type: "connected", endpoint, route: "relay", service, ...listed });
      } catch (cause) {
        const attempt = relayAttempt(cause);
        active.record(accessRecord({ ...facts, confirmed: true, relay: attempt }));
        dispatch({ type: "connect-failed", endpoint, error: relayFailureMessage(attempt, cause) });
      }
    })();
  }, []);

  // Cancel, Escape, or anything else that closes the question: a decline.
  const declineRelay = useCallback(() => {
    const active = session.current;
    const facts = pendingOffer.current;
    pendingOffer.current = undefined;
    if (facts !== undefined) active?.record(accessRecord({ ...facts, confirmed: false }));
    dispatch({ type: "relay-declined" });
  }, []);

  const openProcess = useCallback(
    (summary: ProcessSummary) => {
      const connection = client.current;
      const active = session.current;
      if (connection === undefined || active === undefined) return;
      dispatch({ type: "open-process", processId: summary.id });
      setFieldErrors(NO_ERRORS);
      void (async () => {
        let warnings: readonly string[] = [];
        try {
          const process = await connection.client.getProcess(summary.id, {
            summary,
            // Per call, so the parse warnings can be read off the observation
            // that carries them; forwarded, so the session still records it.
            onObservation: (observation) => {
              if (observation.kind === "process-fetched") warnings = observation.warnings;
              active.record(observation);
            },
          });
          const plan = resolveFormPlan(process);
          const endpoint = connection.endpoint.baseUrl;
          record(formObservationsFor(endpoint, process.id, plan.diagnostics));
          record(
            projectedOnly(plan).map(({ inputId, crs }) => ({
              kind: "form",
              endpoint: redactUrl(endpoint),
              processId: process.id,
              inputId,
              code: "bbox-projected-crs-only",
              keyword: undefined,
              crs,
            })),
          );
          dispatch({
            type: "process-loaded",
            process,
            plan,
            values: initialValues(plan),
            warnings,
          });
        } catch (cause) {
          dispatch({
            type: "process-failed",
            processId: summary.id,
            error: {
              title:
                "Could not read this process's description. Choose it again, or another process.",
              detail: cause instanceof Error ? cause.message : String(cause),
            },
          });
        }
      })();
    },
    [record],
  );

  // Not memoised: a command is only ever called from a handler rendered with
  // the current state, so it reads that state directly.
  const run = () => {
    const connection = client.current;
    const active = session.current;
    if (state.stage !== "process" || connection === undefined || active === undefined) return;

    const errors = validateForm(state.plan, state.values);
    setFieldErrors(errors);
    if (errors.size > 0) return;

    const { process, plan, mode } = state;
    const request = runRequest(process, plan, state.values);
    record(
      request.notes.map((note) => ({
        kind: "form",
        endpoint: redactUrl(connection.endpoint.baseUrl),
        processId: process.id,
        inputId: note.inputId,
        code: note.code,
        keyword: undefined,
        crs: note.crs,
      })),
    );
    setJobNotice(undefined);
    dispatch({ type: "run-started", mode });

    const outputIds = Object.keys(request.outputs);
    const relayEndpoint = relayEndpointFor(connection.endpoint);
    void (async () => {
      try {
        const execution =
          mode === "sync"
            ? await connection.client.execute(process.id, {
                inputs: request.inputs,
                outputs: request.outputs,
                mode: "sync",
                description: process,
              })
            : await active.run(
                relayEndpoint,
                process.id,
                request.inputs,
                request.outputs,
                process,
                connection.reads,
              );
        if (execution.kind === "job") {
          // The reconciler owns the job from here; `run` already tracks an
          // asynchronous one, and a sync request the server made async is
          // handed over here.
          if (mode === "sync") {
            active.track(relayEndpoint, execution.job.statusUrl, connection.reads);
          }
          dispatch({ type: "job-started", jobRef: execution.job.statusUrl });
          return;
        }
        const results = await toRenderable(execution.response, {
          outputIds,
          processId: process.id,
          declaredMediaTypes: declaredMediaTypes(process),
        });
        dispatch({ type: "results", results });
      } catch (cause) {
        if (cause instanceof AmbiguousExecutionResponseError) {
          dispatch({
            type: "run-failed",
            error: {
              title:
                "The server started a job but did not tell this page where to find it. Run it in the foreground, or use an endpoint that runs through the relay.",
              detail:
                "The server does not expose the Location header to web pages (finding 0039). The job may still be running on the server.",
            },
          });
          return;
        }
        dispatch({ type: "run-failed", error: runError(cause, plan) });
      }
    })();
  };

  // An asynchronous run ends when the reconciler says the job did: read its
  // results once it succeeded, or say why there are none.
  useEffect(() => {
    if (state.stage !== "running" || state.run.mode !== "async") return;
    const jobRef = state.run.jobRef;
    if (jobRef === undefined) return;
    const job = snapshot?.jobs.find((row) => row.statusUrl === jobRef);
    const connection = client.current;
    if (job === undefined || connection === undefined) return;

    if (job.gone) {
      dispatch({
        type: "run-failed",
        error: { title: "The server no longer has this job: it was cancelled or has expired." },
      });
      return;
    }
    const status = job.status;
    if (status === undefined || !status.terminal) return;
    if (status.status !== "successful") {
      dispatch({
        type: "run-failed",
        error: {
          title:
            status.status === "dismissed"
              ? "The job was cancelled."
              : "The job failed on the server. Check the inputs and run again.",
          detail: status.message,
        },
      });
      return;
    }
    if (fetching.current === jobRef) return;
    fetching.current = jobRef;
    const outputIds = state.process.outputs.map((output) => output.id);
    const processId = state.process.id;
    const declared = declaredMediaTypes(state.process);
    void (async () => {
      try {
        const { envelope } = await connection.client.getResults(jobRef, { status });
        dispatch({
          type: "results",
          results: await toRenderable(envelope, {
            outputIds,
            processId,
            declaredMediaTypes: declared,
          }),
        });
      } catch (cause) {
        dispatch({
          type: "run-failed",
          error: {
            title: "The job finished, but its results could not be read.",
            detail: cause instanceof Error ? cause.message : String(cause),
          },
        });
      } finally {
        fetching.current = undefined;
      }
    })();
  }, [snapshot, state]);

  const dismissAdvertisedBy: WorkflowView["dismissAdvertisedBy"] =
    state.stage === "choose-endpoint" || state.stage === "connected"
      ? "nothing"
      : state.process.execution.dismiss
        ? "process"
        : state.service.capabilities.dismiss
          ? "service"
          : dismissWorked.has(state.endpoint.baseUrl)
            ? "observed-earlier"
            : "nothing";

  const cancelJob = () => {
    const connection = client.current;
    const active = session.current;
    if (state.stage !== "running" || state.run.mode !== "async" || state.run.jobRef === undefined) {
      return;
    }
    if (connection === undefined || active === undefined) return;
    const jobRef = state.run.jobRef;
    const endpointUrl = state.endpoint.baseUrl;
    const advertisedBy = dismissAdvertisedBy;
    const base = {
      kind: "cancel-job" as const,
      endpoint: redactUrl(state.endpoint.baseUrl),
      processId: state.process.id,
      advertisedBy,
    };
    setJobNotice("Cancelling the job…");
    void (async () => {
      try {
        const dismissal = await connection.client.dismissJob(jobRef);
        if (dismissal.kind === "dismissed") {
          setDismissWorked((seen) => new Set([...seen, endpointUrl]));
          active.record({ ...base, outcome: "dismissed" });
          setJobNotice(undefined);
          dispatch({
            type: "run-failed",
            error: { title: "Job cancelled. The server has dismissed it.", notice: true },
          });
        } else {
          active.record({ ...base, outcome: "unsupported" });
          setJobNotice(
            `The server says it cannot cancel jobs (HTTP ${String(dismissal.status)}). The job keeps running.`,
          );
        }
      } catch (cause) {
        active.record({ ...base, outcome: "failed" });
        setJobNotice(
          `The job could not be cancelled: ${cause instanceof Error ? cause.message : String(cause)}. It may still be running.`,
        );
      }
    })();
  };

  const commands: WorkflowCommands = {
    connect,
    confirmRelay,
    declineRelay,
    disconnect: () => {
      client.current = undefined;
      setFieldErrors(NO_ERRORS);
      dispatch({ type: "disconnect" });
    },
    openProcess,
    backToList: () => {
      setFieldErrors(NO_ERRORS);
      dispatch({ type: "back-to-list" });
    },
    setValue: (id, value) => {
      setFieldErrors((errors) => {
        if (!errors.has(id)) return errors;
        const next = new Map(errors);
        next.delete(id);
        return next;
      });
      dispatch({ type: "set-value", id, value });
    },
    setMode: (mode) => {
      dispatch({ type: "set-mode", mode });
    },
    run,
    cancelJob,
    edit: () => {
      dispatch({ type: "edit" });
    },
  };

  return {
    state,
    commands,
    snapshot,
    configured,
    configuredError,
    fieldErrors,
    jobNotice,
    dismissAdvertisedBy,
  };
}
