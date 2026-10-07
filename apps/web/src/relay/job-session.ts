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
import type { ExecutionObservation, SessionObservation, WebObservation } from "../observations.js";
import type { RelayEndpoint } from "./contract.js";
import { openDoorbells, type DoorbellStream, type StreamState } from "./doorbells.js";
import { JobReconciler, type TrackedJob } from "./reconciler.js";
import { createRelayClient, type RelayClient } from "./relay-client.js";
import { createRelayFetch } from "./relay-fetch.js";
import { createRoutedFetch, type RoutedFetchOptions } from "./routed-fetch.js";
import { NO_STORE, type JobStore, type StoredJob } from "../jobs/job-store.js";
import { RESULT_READ_LIMIT_BYTES } from "../results/renderable.js";

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

  /** Status URLs this tab took off the list: another tab's copy must not bring them back. */
  const removedHere = new Set<string>();
  /**
   * The status URLs storage held when this tab last read it. Only a job that
   * was there and no longer is was removed by another tab; one that never got
   * in (a full quota, a refused write) is not taken for removed.
   */
  let lastStored = new Set<string>();
  const readStorage = (): StoredJob[] => {
    const stored = store.load();
    lastStored = new Set(stored.map((job) => job.statusUrl));
    return stored;
  };

  /**
   * What storage gets: what is there already — other tabs' jobs too — less
   * what this tab removed, plus this tab's jobs that have a process and a
   * start time. Read again just before writing, so no tab's job is lost to
   * another tab's save (W12).
   */
  const persist = (): void => {
    const kept = new Map<string, StoredJob>();
    for (const job of readStorage()) {
      if (!removedHere.has(job.statusUrl)) kept.set(job.statusUrl, job);
    }
    for (const [statusUrl, job] of meta) {
      if (job.processId === undefined || job.startedAt === undefined) continue;
      kept.set(statusUrl, {
        endpoint: job.baseUrl,
        statusUrl,
        processId: job.processId,
        startedAt: job.startedAt,
      });
    }
    store.save([...kept.values()]);
    readStorage();
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
          onDoorbell: (ref, callbacks) => {
            reconciler.doorbell(ref, callbacks);
          },
          onOpen: ({ reconnect }) => {
            if (reconnect) reconciler.reconnected();
          },
          onState: (state) => {
            relayState = state;
            publish();
          },
        });

  /**
   * The read route this page uses, by endpoint base URL: set once the user
   * confirmed the relay for an endpoint, so that a job restored from storage
   * after that is read through it too (review W9).
   */
  const relayReads = new Map<string, { readonly endpointKey: string; readonly read: FetchLike }>();

  /**
   * Restored jobs on an endpoint this page now reads through the relay: they
   * were polled direct, which on a server without CORS fails on every read,
   * and Dismiss failed with them (review W9). They take the read route, and
   * an unsettled one is read again now.
   */
  const adoptRestored = (endpoint: RelayEndpoint, read: FetchLike): void => {
    relayReads.set(endpoint.baseUrl, { endpointKey: endpoint.key, read });
    let changed = false;
    for (const [statusUrl, job] of meta) {
      if (!job.restored || job.read !== undefined || job.baseUrl !== endpoint.baseUrl) continue;
      meta.set(statusUrl, { ...job, endpointKey: endpoint.key, route: "relay", read });
      const tracked = reconciler.jobs().find((each) => each.statusUrl === statusUrl);
      if (tracked !== undefined && !tracked.settled) reconciler.refresh(statusUrl);
      changed = true;
    }
    if (changed) publish();
  };

  /**
   * The read route's wrapper, only when asked for and only where the relay
   * offers it. Asked for means the user confirmed the relay for the endpoint,
   * so the restored jobs on it are moved to the read route as well.
   */
  const readFetch = (endpoint: RelayEndpoint, reads: Reads): FetchLike | undefined => {
    if (
      reads !== "relay" ||
      endpoint.readRoute !== "relay" ||
      relay === undefined ||
      doorbells === undefined
    ) {
      return undefined;
    }
    const read = createRelayFetch({
      relay,
      endpointKey: endpoint.key,
      baseUrl: endpoint.baseUrl,
      session: doorbells,
    });
    adoptRestored(endpoint, read);
    return read;
  };

  // The jobs a previous page started. Polled again without a doorbell: the
  // relay registration belonged to a session this page never had, and whose
  // token was never stored. Each is read direct first, as every connection
  // is, unless this page already reads its endpoint through the relay. A job
  // already finished settles on its first read.
  const restore = (stored: StoredJob): void => {
    const viaRelay = relayReads.get(stored.endpoint);
    meta.set(stored.statusUrl, {
      endpointKey: viaRelay?.endpointKey ?? "",
      baseUrl: stored.endpoint,
      route: viaRelay === undefined ? "direct" : "relay",
      read: viaRelay?.read,
      processId: stored.processId,
      startedAt: stored.startedAt,
      restored: true,
    });
    reconciler.track(stored.statusUrl);
  };
  for (const stored of readStorage()) restore(stored);

  // Another tab changed the list: its new jobs appear here, polled like any
  // restored one, and a job it removed goes from here too (W12).
  const unsubscribeStore = store.subscribe(() => {
    const before = lastStored;
    const stored = readStorage();
    let changed = false;
    for (const job of stored) {
      if (meta.has(job.statusUrl) || removedHere.has(job.statusUrl)) continue;
      restore(job);
      changed = true;
    }
    for (const statusUrl of before) {
      if (lastStored.has(statusUrl) || !meta.has(statusUrl)) continue;
      reconciler.untrack(statusUrl);
      meta.delete(statusUrl);
      changed = true;
    }
    if (changed) publish();
  });

  /**
   * A core client for one endpoint, sending through the routed fetch and
   * reporting into this session. Its `execution` records say which route the
   * execute request took (W13): through the relay, `Location` and
   * `Preference-Applied` are what the relay read and handed back, so the
   * core's own fields describe the relay's view, not the page's.
   *
   * The routed fetch reports every relay attempt, whatever its outcome,
   * before the core writes its `execution` record; a request it reports
   * nothing for went direct. One client sends one execute at a time in
   * practice, and two at once would take the same route anyway.
   */
  const routedClient = (
    endpoint: RelayEndpoint,
    read: FetchLike | undefined,
    hooks: Pick<RoutedFetchOptions, "onRoute" | "onRegistration"> = {},
  ): Client => {
    const observe = observeFor(endpoint.baseUrl);
    let reported: "direct" | "relay" | undefined;
    return createClient({
      baseUrl: endpoint.baseUrl,
      // A run's result, sync or async, read whole for its download (review
      // W7). The core sets the limit per client, so the endpoint's other
      // answers share it; an output given by reference does not go through
      // here, and keeps the core's.
      maxBufferBytes: RESULT_READ_LIMIT_BYTES,
      onObservation: (observation) => {
        if (observation.kind !== "execution") {
          observe(observation);
          return;
        }
        const tagged: ExecutionObservation = { ...observation, executeRoute: reported ?? "direct" };
        reported = undefined;
        observe(tagged);
      },
      fetch: createRoutedFetch({
        endpoint,
        relay,
        session: doorbells,
        ...(read === undefined ? {} : { fetch: read, reads: "relay" }),
        onRoute: (observation) => {
          reported = observation.route;
          observe(observation);
          hooks.onRoute?.(observation);
        },
        ...(hooks.onRegistration === undefined ? {} : { onRegistration: hooks.onRegistration }),
      }),
    });
  };

  return {
    async endpoints() {
      return relay === undefined ? [] : relay.endpoints();
    },

    readFetch,

    client(endpoint, reads = "direct") {
      return routedClient(endpoint, readFetch(endpoint, reads));
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
      removedHere.add(statusUrl);
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
      const client = routedClient(endpoint, read, {
        onRoute: (observation) => {
          route = observation.route;
        },
        onRegistration: (ref, statusUrl) => {
          if (statusUrl !== undefined) refs.set(statusUrl, ref);
        },
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
      unsubscribeStore();
      doorbells?.close();
      reconciler.dispose();
      listeners.clear();
    },
  };
}
