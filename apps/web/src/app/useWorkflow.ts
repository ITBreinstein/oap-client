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
  type ProcessDescription,
  type ProcessSummary,
} from "@breinstein/oap-client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { drawableCrs } from "../forms/crs.js";
import { initialValues } from "../forms/defaults.js";
import type { BboxControl, Control, FormPlan } from "../forms/plan.js";
import { resolveFormPlan } from "../forms/resolve.js";
import { schemaWarnings } from "../forms/schema-warnings.js";
import { validateForm, type FieldErrors } from "../forms/validate.js";
import {
  formObservationsFor,
  loadedObservation,
  resultObservations,
  type FormObservation,
  type RunFacts,
} from "../observations.js";
import { isMixedContent, pageProtocol } from "../mixed-content.js";
import { createJobStore } from "../jobs/job-store.js";
import type { RelayEndpoint } from "../relay/contract.js";
import {
  createJobSession,
  type DismissAdvertisedBy,
  type JobRow,
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
import { loadReference as followReference } from "../results/reference.js";
import { toRenderable, type RenderableResult } from "../results/renderable.js";
import { declaredMediaTypes, relayEndpointFor, runError, runRequest } from "./run.js";
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
  /** Task 8, T2: ask for one output as a value (as the server prefers) or a link. */
  readonly setTransmission: (outputId: string, transmission: "value" | "reference") => void;
  readonly run: () => void;
  readonly cancelJob: () => void;
  readonly edit: () => void;
  /**
   * "Load" on an output given by reference (Task 8, T3): the only way its href
   * is ever fetched. Settles when the result screen has what it found.
   */
  readonly loadReference: (outputId: string) => Promise<void>;
  /**
   * The process census: describe every listed process once, through the
   * connection's route, so the session's observations cover the whole
   * catalogue and not only the processes someone happened to open.
   */
  readonly describeAll: () => void;
  /** "Remove from list": this browser forgets the job. The server is not told. */
  readonly removeJob: (statusUrl: string) => void;
  /** "Dismiss", once confirmed: `DELETE` the job on the server. */
  readonly dismissJob: (statusUrl: string) => void;
}

/**
 * How far the census has got. Failed descriptions leave no observation of
 * their own — the matrix reads them as listed but not described — so they are
 * only counted here.
 */
export interface CensusProgress {
  readonly endpoint: string;
  readonly total: number;
  readonly described: number;
  readonly failed: number;
  readonly running: boolean;
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
  readonly dismissAdvertisedBy: DismissAdvertisedBy;
  /**
   * The same question for one job in "My jobs", which may belong to another
   * endpoint than the one open. `nothing` hides its Dismiss.
   */
  readonly dismissAdvertisedFor: (job: JobRow) => DismissAdvertisedBy;
  /** What the last Dismiss of a job ended in, by status URL. */
  readonly jobMessages: ReadonlyMap<string, string>;
  readonly census: CensusProgress | undefined;
}

const NO_ERRORS: FieldErrors = new Map();

let runCounter = 0;

/**
 * Task 8, T9: pairs a Load's record with its run's. Random, so exports from
 * two sessions do not collide; never derived from inputs or URLs.
 */
function newRunId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    // Not a secure context: randomUUID is missing there.
    runCounter += 1;
    return `run-${String(runCounter)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** What a refused `http:` address says. Nothing was sent, so it names no server behaviour. */
const MIXED_CONTENT_ERROR: WorkflowError = {
  title:
    "This page is served over HTTPS, so the browser blocks requests to a plain http:// address. Nothing was sent.",
  detail:
    "Use the service's https:// address if it has one. The attempt has been recorded as mixed content, not as a server failure.",
};

function transportMessage(cause: unknown, endpoint: EndpointRef): WorkflowError {
  if (directFailure(cause) === "cors-blocked") {
    // Said as one of two, never as a diagnosis: a browser gives a page the same
    // error for a server that sends no CORS headers and for one that is down
    // (W34). What to do next depends on where the address came from, and on
    // whether the relay may read this server (findings 0049, 0050).
    const next =
      endpoint.source !== "configured"
        ? "Check the address and that the server is running. If both are right, choose another service, or ask this server's operator to enable CORS."
        : endpoint.readRoute === "relay"
          ? "Connect again to be offered the relay, which reaches the server without CORS and so tells the two apart, or choose another service."
          : "The relay is not set up to read this service for a web page, so it cannot help here. Check that the server is running. If it is, choose another service, or ask this server's operator to enable CORS.";
    return {
      title:
        "This page could not read this server: it sends no CORS headers, or it could not be reached. The attempt has been recorded.",
      detail: `A browser gives a web page the same error for both. A page may only read another site's answers when that site sends Access-Control-Allow-Origin. ${next}`,
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

/** What form generation made of one description, as observations. */
function formObservationsOf(
  endpoint: string,
  process: ProcessDescription,
  plan: FormPlan,
): FormObservation[] {
  return [
    ...formObservationsFor(endpoint, process.id, plan.diagnostics),
    ...projectedOnly(plan).map(({ inputId, crs }) => ({
      kind: "form" as const,
      endpoint: redactUrl(endpoint),
      processId: process.id,
      inputId,
      code: "bbox-projected-crs-only" as const,
      keyword: undefined,
      crs,
    })),
  ];
}

export function useWorkflow(relayUrl: string | undefined, acceptedNoticeMs?: number): WorkflowView {
  const [state, dispatch] = useReducer(workflowReducer, INITIAL_WORKFLOW);
  const [snapshot, setSnapshot] = useState<JobSessionSnapshot | undefined>();
  const [configured, setConfigured] = useState<RelayEndpoint[]>([]);
  const [configuredError, setConfiguredError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_ERRORS);
  const [jobNotice, setJobNotice] = useState<string | undefined>();
  const [jobMessages, setJobMessages] = useState<ReadonlyMap<string, string>>(() => new Map());

  // Made inside the effect, for the reason AsyncJobPanel gives: StrictMode
  // runs effects twice, and a memoised session would be disposed and reused.
  const session = useRef<JobSession | undefined>(undefined);
  const client = useRef<
    | {
        readonly endpoint: EndpointRef;
        readonly client: Client;
        readonly reads: Reads;
        /** Which connection this is: what an answer on it is told apart by (W4). */
        readonly id: number;
      }
    | undefined
  >(undefined);
  /** Connections made so far; each successful one takes the next number. */
  const connections = useRef(0);
  /** The direct attempt behind an open offer, for the record its answer completes. */
  const pendingOffer = useRef<AttemptFacts | undefined>(undefined);
  const relayAvailable = relayUrl !== undefined && relayUrl !== "";
  /** Endpoints where a dismissal has been seen to work this session (T6). */
  const [dismissWorked, setDismissWorked] = useState<ReadonlySet<string>>(() => new Set());
  /** Form observations already recorded, so reopening a process does not repeat them. */
  const recorded = useRef(new Set<string>());
  /** The job whose results are being fetched, so a snapshot burst fetches once. */
  const fetching = useRef<string | undefined>(undefined);
  const [census, setCensus] = useState<CensusProgress | undefined>();
  /** The run whose results are on screen, for their observations (Task 8, T9). */
  const lastRun = useRef<RunFacts | undefined>(undefined);

  /** The first record for each output, as the result is shown. */
  const recordResults = useCallback((results: readonly RenderableResult[]) => {
    const run = lastRun.current;
    if (run === undefined) return;
    for (const observation of resultObservations(run, results)) {
      session.current?.record(run.endpoint, observation);
    }
  }, []);

  useEffect(() => {
    const created = createJobSession(relayUrl, { acceptedNoticeMs, store: createJobStore() });
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
  }, [relayUrl, acceptedNoticeMs]);

  const record = useCallback((observations: readonly FormObservation[]) => {
    for (const observation of observations) {
      const key = JSON.stringify(observation);
      if (recorded.current.has(key)) continue;
      recorded.current.add(key);
      session.current?.record(observation.endpoint, observation);
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
      // Refused before sending: the browser would block it, and the opaque
      // error it throws cross-origin is indistinguishable from CORS.
      if (isMixedContent(new URL(endpoint.baseUrl), pageProtocol())) {
        active.record(
          endpoint.baseUrl,
          accessRecord({
            endpoint,
            at,
            relayAvailable,
            direct: "mixed-content",
            directError: undefined,
          }),
        );
        dispatch({ type: "connect-failed", endpoint, error: MIXED_CONTENT_ERROR });
        return;
      }
      const connection = active.client(relayEndpointFor(endpoint), "direct");
      void (async () => {
        try {
          const service = await connection.inspect();
          const processes = await connection.listProcesses();
          connections.current += 1;
          const id = connections.current;
          client.current = { endpoint, client: connection, reads: "direct", id };
          active.record(
            endpoint.baseUrl,
            accessRecord({
              endpoint,
              at,
              relayAvailable,
              direct: "connected",
              directError: undefined,
            }),
          );
          dispatch({
            type: "connected",
            endpoint,
            connection: id,
            route: "direct",
            service,
            processes,
          });
        } catch (cause) {
          const direct = directFailure(cause);
          const facts = { endpoint, at, relayAvailable, direct, directError: errorName(cause) };
          const error = transportMessage(cause, endpoint);
          if (offersRelay(endpoint, direct, relayAvailable)) {
            pendingOffer.current = facts;
            dispatch({ type: "relay-offered", endpoint, error });
            return;
          }
          active.record(endpoint.baseUrl, accessRecord(facts));
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
        const processes = await connection.listProcesses();
        connections.current += 1;
        const id = connections.current;
        client.current = { endpoint, client: connection, reads: "relay", id };
        active.record(
          endpoint.baseUrl,
          accessRecord({ ...facts, confirmed: true, relay: relayAttempt(undefined) }),
        );
        dispatch({
          type: "connected",
          endpoint,
          connection: id,
          route: "relay",
          service,
          processes,
        });
      } catch (cause) {
        const attempt = relayAttempt(cause);
        active.record(
          endpoint.baseUrl,
          accessRecord({ ...facts, confirmed: true, relay: attempt }),
        );
        dispatch({ type: "connect-failed", endpoint, error: relayFailureMessage(attempt, cause) });
      }
    })();
  }, []);

  // Cancel, Escape, or anything else that closes the question: a decline.
  const declineRelay = useCallback(() => {
    const active = session.current;
    const facts = pendingOffer.current;
    pendingOffer.current = undefined;
    if (facts !== undefined) {
      active?.record(facts.endpoint.baseUrl, accessRecord({ ...facts, confirmed: false }));
    }
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
              active.record(connection.endpoint.baseUrl, observation);
            },
          });
          const plan = resolveFormPlan(process);
          record(formObservationsOf(connection.endpoint.baseUrl, process, plan));
          dispatch({
            type: "process-loaded",
            connection: connection.id,
            process,
            plan,
            values: initialValues(plan),
            warnings,
          });
        } catch (cause) {
          dispatch({
            type: "process-failed",
            connection: connection.id,
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

    const { process, plan, mode, linkOutputs } = state;
    const request = runRequest(process, plan, state.values, linkOutputs);
    // Package 6: the schema warnings were on screen and do not stop the run;
    // an input whose value could not be checked is recorded, once.
    record(
      schemaWarnings(process, plan, state.values).notChecked.map(({ inputId, keyword }) => ({
        kind: "form",
        endpoint: redactUrl(connection.endpoint.baseUrl),
        processId: process.id,
        inputId,
        code: "schema-not-checked",
        keyword,
        crs: undefined,
      })),
    );
    const runId = newRunId();
    lastRun.current = {
      runId,
      endpoint: connection.endpoint.baseUrl,
      processId: process.id,
      declaredTransmission: process.outputTransmission,
      linkOutputs,
    };
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
    dispatch({ type: "run-started", runId, mode });

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
            active.track(relayEndpoint, execution.job.statusUrl, connection.reads, process.id);
          }
          dispatch({ type: "job-started", runId, jobRef: execution.job.statusUrl });
          return;
        }
        const results = await toRenderable(execution.response, {
          outputIds,
          processId: process.id,
          declaredMediaTypes: declaredMediaTypes(process),
        });
        recordResults(results);
        dispatch({ type: "results", runId, results });
      } catch (cause) {
        if (cause instanceof AmbiguousExecutionResponseError) {
          dispatch({
            type: "run-failed",
            runId,
            error: {
              title:
                "The server started a job but did not tell this page where to find it. Run it in the foreground, or use an endpoint that runs through the relay.",
              detail:
                "The server does not expose the Location header to web pages (finding 0039). The job may still be running on the server.",
            },
          });
          return;
        }
        dispatch({ type: "run-failed", runId, error: runError(cause, plan) });
      }
    })();
  };

  // An asynchronous run ends when the reconciler says the job did: read its
  // results once it succeeded, or say why there are none.
  useEffect(() => {
    if (state.stage !== "running" || state.run.mode !== "async") return;
    const jobRef = state.run.jobRef;
    if (jobRef === undefined) return;
    const { runId } = state;
    const job = snapshot?.jobs.find((row) => row.statusUrl === jobRef);
    const connection = client.current;
    if (job === undefined || connection === undefined) return;

    if (job.gone) {
      dispatch({
        type: "run-failed",
        runId,
        error: { title: "The server no longer has this job: it was cancelled or has expired." },
      });
      return;
    }
    const status = job.status;
    if (status === undefined || !status.terminal) return;
    // A job the server first called successful keeps its results even when
    // the confirming read found the status changed (finding 0047): the screen
    // shows both, and the results the server handed out.
    const decided = job.confirmation?.state === "changed" ? job.confirmation.first : status;
    if (decided.status !== "successful") {
      dispatch({
        type: "run-failed",
        runId,
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
        const { envelope } = await connection.client.getResults(jobRef, { status: decided });
        const results = await toRenderable(envelope, {
          outputIds,
          processId,
          declaredMediaTypes: declared,
        });
        recordResults(results);
        dispatch({ type: "results", runId, results });
      } catch (cause) {
        dispatch({
          type: "run-failed",
          runId,
          error: {
            title: "The job finished, but its results could not be read.",
            detail: cause instanceof Error ? cause.message : String(cause),
          },
        });
      } finally {
        fetching.current = undefined;
      }
    })();
  }, [snapshot, state, recordResults]);

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

  const dismissAdvertisedFor = (job: JobRow): DismissAdvertisedBy => {
    if (state.stage !== "choose-endpoint" && state.endpoint.baseUrl === job.endpoint) {
      if (
        (state.stage === "process" || state.stage === "running" || state.stage === "result") &&
        state.process.id === job.processId &&
        state.process.execution.dismiss
      ) {
        return "process";
      }
      if (state.service.capabilities.dismiss) return "service";
    }
    return dismissWorked.has(job.endpoint) ? "observed-earlier" : "nothing";
  };

  const setJobMessage = (statusUrl: string, message: string | undefined) => {
    setJobMessages((messages) => {
      const next = new Map(messages);
      if (message === undefined) next.delete(statusUrl);
      else next.set(statusUrl, message);
      return next;
    });
  };

  const removeJob = (statusUrl: string) => {
    setJobMessage(statusUrl, undefined);
    session.current?.remove(statusUrl);
  };

  const dismissListedJob = (statusUrl: string) => {
    const active = session.current;
    const job = snapshot?.jobs.find((row) => row.statusUrl === statusUrl);
    if (active === undefined || job === undefined) return;
    const advertisedBy = dismissAdvertisedFor(job);
    // Offered only where advertised or seen to work; a stale click is ignored.
    if (advertisedBy === "nothing") return;
    const base = {
      kind: "cancel-job" as const,
      endpoint: redactUrl(job.endpoint),
      processId: job.processId ?? "",
      advertisedBy,
    };
    setJobMessage(statusUrl, "Dismissing…");
    void (async () => {
      try {
        const dismissal = await active.dismiss(statusUrl);
        if (dismissal.kind === "dismissed") {
          setDismissWorked((seen) => new Set([...seen, job.endpoint]));
          active.record(job.endpoint, { ...base, outcome: "dismissed" });
          setJobMessage(statusUrl, "Dismissed on the server.");
        } else {
          active.record(job.endpoint, { ...base, outcome: "unsupported" });
          setJobMessage(
            statusUrl,
            `The server says it cannot dismiss jobs (HTTP ${String(dismissal.status)}).`,
          );
        }
      } catch (cause) {
        active.record(job.endpoint, { ...base, outcome: "failed" });
        setJobMessage(
          statusUrl,
          `The job could not be dismissed: ${cause instanceof Error ? cause.message : String(cause)}.`,
        );
      }
    })();
  };

  const cancelJob = () => {
    const connection = client.current;
    const active = session.current;
    if (state.stage !== "running" || state.run.mode !== "async" || state.run.jobRef === undefined) {
      return;
    }
    if (connection === undefined || active === undefined) return;
    const jobRef = state.run.jobRef;
    const { runId } = state;
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
          active.record(endpointUrl, { ...base, outcome: "dismissed" });
          setJobNotice(undefined);
          dispatch({
            type: "run-failed",
            runId,
            error: { title: "Job cancelled. The server has dismissed it.", notice: true },
          });
        } else {
          active.record(endpointUrl, { ...base, outcome: "unsupported" });
          setJobNotice(
            `The server says it cannot cancel jobs (HTTP ${String(dismissal.status)}). The job keeps running.`,
          );
        }
      } catch (cause) {
        active.record(endpointUrl, { ...base, outcome: "failed" });
        setJobNotice(
          `The job could not be cancelled: ${cause instanceof Error ? cause.message : String(cause)}. It may still be running.`,
        );
      }
    })();
  };

  // One description at a time: a census is for the record, not for speed, and
  // a server should not see it as a burst. Stops when the connection changes.
  const describeAll = () => {
    const connection = client.current;
    if (state.stage === "choose-endpoint" || connection === undefined) return;
    if (census?.running === true) return;
    const summaries = state.processes.processes;
    const endpoint = redactUrl(connection.endpoint.baseUrl);
    let progress: CensusProgress = {
      endpoint,
      total: summaries.length,
      described: 0,
      failed: 0,
      running: true,
    };
    setCensus(progress);
    void (async () => {
      for (const summary of summaries) {
        if (client.current !== connection) break;
        try {
          const process = await connection.client.getProcess(summary.id, { summary });
          record(
            formObservationsOf(connection.endpoint.baseUrl, process, resolveFormPlan(process)),
          );
          progress = { ...progress, described: progress.described + 1 };
        } catch {
          progress = { ...progress, failed: progress.failed + 1 };
        }
        setCensus(progress);
      }
      setCensus({ ...progress, running: false });
    })();
  };

  // Direct unless this connection's reads already go through the relay and the
  // href is this endpoint's own (reference.ts, Task 8, T4).
  const loadReference = async (outputId: string): Promise<void> => {
    const connection = client.current;
    const active = session.current;
    const run = lastRun.current;
    if (state.stage !== "result" || connection === undefined || active === undefined) return;
    const result = state.results.find(
      (candidate) => candidate.kind === "reference" && candidate.outputId === outputId,
    );
    if (result?.kind !== "reference") return;
    const { runId } = state;
    const loaded = await followReference(result, {
      endpoint: { baseUrl: connection.endpoint.baseUrl, reads: connection.reads },
      relayFetch: active.readFetch(relayEndpointFor(connection.endpoint), connection.reads),
      pageProtocol: pageProtocol(),
    });
    if (run !== undefined) {
      active.record(connection.endpoint.baseUrl, loadedObservation(run, result, loaded));
    }
    dispatch({ type: "reference-loaded", runId, outputId, loaded });
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
    setTransmission: (outputId, transmission) => {
      dispatch({ type: "set-transmission", outputId, transmission });
    },
    run,
    cancelJob,
    edit: () => {
      dispatch({ type: "edit" });
    },
    loadReference,
    describeAll,
    removeJob,
    dismissJob: dismissListedJob,
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
    dismissAdvertisedFor,
    jobMessages,
    census,
  };
}
