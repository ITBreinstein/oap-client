/**
 * One page's asynchronous jobs: the relay (when there is one), the doorbell
 * stream, and the reconciler, composed once and handed to the UI as snapshots.
 *
 * Kept free of React so it can be driven the same way from a test, a component
 * or a console. The UI subscribes; it never reaches into the parts.
 *
 * With no relay configured this still works — every endpoint is direct, there
 * is no doorbell, and the reconciler's baseline poll does all the work. That
 * is the "useful with the relay switched off" requirement, and the reason the
 * relay is optional all the way down.
 */

import {
  createClient,
  dismissJob,
  getJob,
  redactUrl,
  type Dismissal,
  type Client,
  type FetchLike,
  type ExecuteOutputSelection,
  type Execution,
  type ProcessDescription,
} from "@breinstein/oap-client";
import type { SessionObservation, WebObservation } from "../observations.js";
import type { RelayEndpoint } from "./contract.js";
import { openDoorbells, type DoorbellStream, type StreamState } from "./doorbells.js";
import { JobReconciler, type TrackedJob } from "./reconciler.js";
import { createRelayClient, type RelayClient } from "./relay-client.js";
import { createRelayFetch } from "./relay-fetch.js";
import { createRoutedFetch } from "./routed-fetch.js";
import { NO_STORE, type JobStore, type StoredJob } from "../jobs/job-store.js";

/**
 * How this page reads one endpoint, decided per connection: `direct` always
 * first, `relay` only after a CORS failure the user confirmed the fallback for.
 * Never remembered past the page: reconnecting starts direct again.
 */
export type Reads = "direct" | "relay";

export interface JobRow extends TrackedJob {
  readonly endpointKey: string;
  /** The endpoint's base URL. */
  readonly endpoint: string;
  readonly route: "direct" | "relay" | undefined;
  /** Undefined for a job this page was only asked to watch. */
  readonly processId: string | undefined;
  /** ISO 8601, when this browser started the job. */
  readonly startedAt: string | undefined;
  /** Found in storage after a reload, rather than started on this page. */
  readonly restored: boolean;
}

/**
 * Where the page learned that a job can be dismissed, if anywhere: the
 * declared-versus-observed pair the matrix records for dismissal (T6).
 */
export type DismissAdvertisedBy = "process" | "service" | "observed-earlier" | "nothing";

export interface JobSessionSnapshot {
  readonly relay: "off" | StreamState;
  readonly jobs: readonly JobRow[];
  readonly observations: readonly SessionObservation[];
  /** Observations dropped from the front to keep the cap; 0 until it is reached. */
  readonly droppedObservations: number;
}

export interface JobSession {
  endpoints(): Promise<RelayEndpoint[]>;
  /**
   * A core client for one endpoint, reporting into this session's
   * observations and sending through the same route choice as `run`. For
   * everything but an asynchronous execute: discovery, the process list and
   * descriptions, a synchronous run, results and dismissal.
   *
   * `reads: "relay"` sends all of that through the relay's read route, and is
   * ignored for an endpoint the relay does not offer it for.
   */
  client(endpoint: RelayEndpoint, reads?: Reads): Client;
  /**
   * The read route's `fetch` for one endpoint, or undefined unless `reads` is
   * `relay` and the relay offers that endpoint the read route. For a URL a
   * result handed back rather than one the core built; it refuses anything
   * outside the endpoint's `baseUrl` by itself.
   */
  readFetch(endpoint: RelayEndpoint, reads: Reads): FetchLike | undefined;
  /**
   * Start one asynchronous execution. Resolves once the job is known, or refused.
   * Pass the description and the core uses its `execute` link and checks arity.
   */
  run(
    endpoint: RelayEndpoint,
    processId: string,
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
    description?: ProcessDescription,
    reads?: Reads,
  ): Promise<Execution>;
  /** Start reconciling a job the caller found some other way — a sync run the server made async. */
  track(endpoint: RelayEndpoint, statusUrl: string, reads?: Reads, processId?: string): void;
  /** Take a job off this browser's list, and out of storage. The server is not told. */
  remove(statusUrl: string): void;
  /**
   * Ask the server to dismiss a job (`DELETE`), through the route its reads
   * take, then read it again. The core records the attempt.
   */
  dismiss(statusUrl: string): Promise<Dismissal>;
  /**
   * Add an observation the web app made itself (T4), or one the caller took
   * from a core call of its own, against the endpoint it was made for.
   */
  record(endpoint: string, observation: WebObservation): void;
  subscribe(listener: (snapshot: JobSessionSnapshot) => void): () => void;
  dispose(): void;
}

/**
 * Enough for a long demo session and a process census of a large catalogue,
 * bounded so a page left open for a day does not grow without limit. ZOO's
 * census alone leaves well over a thousand, the first cap, and pushed every
 * earlier endpoint's observations out without a trace. What is dropped is now
 * counted, and the count travels with the export.
 */
const OBSERVATIONS_KEPT = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The `outputs` block, checked entry by entry against §7.11's shape. What a
 * person typed is not trusted to be one.
 */
export function toOutputSelection(
  value: Record<string, unknown>,
): Record<string, ExecuteOutputSelection> {
  const selection: Record<string, ExecuteOutputSelection> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) throw new Error(`output "${id}" must be an object`);
    const mode = entry["transmissionMode"];
    if (mode !== undefined && mode !== "value" && mode !== "reference") {
      throw new Error(`output "${id}": transmissionMode must be "value" or "reference"`);
    }
    const format = entry["format"];
    let checkedFormat: ExecuteOutputSelection["format"];
    if (format !== undefined) {
      if (!isRecord(format)) throw new Error(`output "${id}": format must be an object`);
      const { mediaType, encoding } = format;
      if (
        (mediaType !== undefined && typeof mediaType !== "string") ||
        (encoding !== undefined && typeof encoding !== "string")
      ) {
        throw new Error(`output "${id}": format members must be strings`);
      }
      checkedFormat = {
        ...(mediaType === undefined ? {} : { mediaType }),
        ...(encoding === undefined ? {} : { encoding }),
      };
    }
    selection[id] = {
      ...(mode === undefined ? {} : { transmissionMode: mode }),
      ...(checkedFormat === undefined ? {} : { format: checkedFormat }),
    };
  }
  return selection;
}

export interface JobSessionOptions {
  /** How long a job may stay `accepted` before its row says so. */
  readonly acceptedNoticeMs?: number | undefined;
  /**
   * Where the jobs this browser started are kept across a reload. None by
   * default: only the page's own session persists, never a developer panel's.
   */
  readonly store?: JobStore | undefined;
  /** This browser's clock, for a job's start time. */
  readonly now?: (() => Date) | undefined;
}

export function createJobSession(
  relayUrl: string | undefined,
  options: JobSessionOptions = {},
): JobSession {
  const relay: RelayClient | undefined =
    relayUrl === undefined || relayUrl === "" ? undefined : createRelayClient(relayUrl);

  let relayState: JobSessionSnapshot["relay"] = relay === undefined ? "off" : "connecting";
  let observations: SessionObservation[] = [];
  let dropped = 0;
  const store = options.store ?? NO_STORE;
  const now = options.now ?? (() => new Date());
  const meta = new Map<
    string,
    {
      endpointKey: string;
      /** The endpoint's base URL, which the job's observations are recorded against. */
      baseUrl: string;
      route: "direct" | "relay" | undefined;
      /** The read route's wrapper, when this job's endpoint is read through the relay. */
      read: FetchLike | undefined;
      processId: string | undefined;
      startedAt: string | undefined;
      restored: boolean;
    }
  >();

  /** What storage gets: jobs with a process and a start time, in the order started. */
  const persist = (): void => {
    const kept: StoredJob[] = [];
    for (const [statusUrl, job] of meta) {
      if (job.processId === undefined || job.startedAt === undefined) continue;
      kept.push({
        endpoint: job.baseUrl,
        statusUrl,
        processId: job.processId,
        startedAt: job.startedAt,
      });
    }
    store.save(kept);
  };
  const listeners = new Set<(snapshot: JobSessionSnapshot) => void>();

  const snapshot = (): JobSessionSnapshot => ({
    relay: relayState,
    jobs: reconciler.jobs().map((job) => ({
      ...job,
      endpointKey: meta.get(job.statusUrl)?.endpointKey ?? "",
      endpoint: meta.get(job.statusUrl)?.baseUrl ?? "",
      route: meta.get(job.statusUrl)?.route,
      processId: meta.get(job.statusUrl)?.processId,
      startedAt: meta.get(job.statusUrl)?.startedAt,
      restored: meta.get(job.statusUrl)?.restored ?? false,
    })),
    observations,
    droppedObservations: dropped,
  });
  const publish = (): void => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  // Tagged with the endpoint as they arrive: several core observations carry
  // no URL at all (`capabilities-derived`), so this is the only place the
  // endpoint an observation belongs to is still known.
  const observeFor =
    (baseUrl: string) =>
    (observation: WebObservation): void => {
      const entry = { endpoint: redactUrl(baseUrl), observation };
      if (observations.length >= OBSERVATIONS_KEPT) dropped += 1;
      observations = [...observations.slice(1 - OBSERVATIONS_KEPT), entry];
      publish();
    };

  const reconciler = new JobReconciler({
    readJob: (statusUrl, signal) => {
      const job = meta.get(statusUrl);
      const read = job?.read;
      return getJob(statusUrl, {
        signal,
        onObservation: observeFor(job?.baseUrl ?? statusUrl),
        ...(read === undefined ? {} : { fetch: read }),
      });
    },
    onChange: publish,
    acceptedNoticeMs: options.acceptedNoticeMs,
  });

  const doorbells: DoorbellStream | undefined =
    relay === undefined
      ? undefined
      : openDoorbells({
          relay,
          onDoorbell: (ref) => {
            reconciler.doorbell(ref);
          },
          onOpen: ({ reconnect }) => {
            if (reconnect) reconciler.reconnected();
          },
          onState: (state) => {
            relayState = state;
            publish();
          },
        });

  /** The read route's wrapper, only when asked for and only where the relay offers it. */
  const readFetch = (endpoint: RelayEndpoint, reads: Reads): FetchLike | undefined =>
    reads === "relay" &&
    endpoint.readRoute === "relay" &&
    relay !== undefined &&
    doorbells !== undefined
      ? createRelayFetch({
          relay,
          endpointKey: endpoint.key,
          baseUrl: endpoint.baseUrl,
          session: doorbells,
        })
      : undefined;

  // The jobs a previous page started. Polled again, each read direct first
  // as every connection is, and without a doorbell: the relay registration
  // belonged to a session this page never had, and whose token was never
  // stored. A job already finished settles on its first read.
  for (const stored of store.load()) {
    meta.set(stored.statusUrl, {
      endpointKey: "",
      baseUrl: stored.endpoint,
      route: "direct",
      read: undefined,
      processId: stored.processId,
      startedAt: stored.startedAt,
      restored: true,
    });
    reconciler.track(stored.statusUrl);
  }

  return {
    async endpoints() {
      return relay === undefined ? [] : relay.endpoints();
    },

    readFetch,

    client(endpoint, reads = "direct") {
      const read = readFetch(endpoint, reads);
      const observe = observeFor(endpoint.baseUrl);
      return createClient({
        baseUrl: endpoint.baseUrl,
        onObservation: observe,
        fetch: createRoutedFetch({
          endpoint,
          relay,
          session: doorbells,
          onRoute: observe,
          ...(read === undefined ? {} : { fetch: read, reads: "relay" }),
        }),
      });
    },

    track(endpoint, statusUrl, reads = "direct", processId) {
      const read = readFetch(endpoint, reads);
      meta.set(statusUrl, {
        endpointKey: endpoint.key,
        baseUrl: endpoint.baseUrl,
        route: read === undefined ? "direct" : "relay",
        read,
        processId,
        startedAt: now().toISOString(),
        restored: false,
      });
      persist();
      reconciler.track(statusUrl);
    },

    remove(statusUrl) {
      if (!meta.has(statusUrl)) return;
      reconciler.untrack(statusUrl);
      meta.delete(statusUrl);
      persist();
      publish();
    },

    async dismiss(statusUrl) {
      const job = meta.get(statusUrl);
      const dismissal = await dismissJob(statusUrl, {
        onObservation: observeFor(job?.baseUrl ?? statusUrl),
        ...(job?.read === undefined ? {} : { fetch: job.read }),
      });
      reconciler.refresh(statusUrl);
      return dismissal;
    },

    record(endpoint, observation) {
      observeFor(endpoint)(observation);
    },

    async run(endpoint, processId, inputs, outputs, description, reads = "direct") {
      const startedAt = now().toISOString();
      const refs = new Map<string, string>();
      let route: "direct" | "relay" | undefined;
      const read = readFetch(endpoint, reads);
      const observe = observeFor(endpoint.baseUrl);
      const client = createClient({
        baseUrl: endpoint.baseUrl,
        onObservation: observe,
        fetch: createRoutedFetch({
          endpoint,
          relay,
          session: doorbells,
          ...(read === undefined ? {} : { fetch: read, reads: "relay" }),
          onRoute: (observation) => {
            route = observation.route;
            observe(observation);
          },
          onRegistration: (ref, statusUrl) => {
            if (statusUrl !== undefined) refs.set(statusUrl, ref);
          },
        }),
      });
      const execution = await client.execute(processId, {
        inputs,
        outputs: toOutputSelection(outputs),
        mode: "async",
        ...(description === undefined ? {} : { description }),
      });
      if (execution.kind === "job") {
        const { statusUrl } = execution.job;
        meta.set(statusUrl, {
          endpointKey: endpoint.key,
          baseUrl: endpoint.baseUrl,
          route,
          read,
          processId,
          startedAt,
          restored: false,
        });
        persist();
        reconciler.track(statusUrl, refs.get(statusUrl));
      }
      return execution;
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      doorbells?.close();
      reconciler.dispose();
      listeners.clear();
    },
  };
}
