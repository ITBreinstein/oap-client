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
  getJob,
  redactUrl,
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

/**
 * How this page reads one endpoint, decided per connection: `direct` always
 * first, `relay` only after a CORS failure the user confirmed the fallback for.
 * Never remembered past the page: reconnecting starts direct again.
 */
export type Reads = "direct" | "relay";

export interface JobRow extends TrackedJob {
  readonly endpointKey: string;
  readonly route: "direct" | "relay" | undefined;
}

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
  track(endpoint: RelayEndpoint, statusUrl: string, reads?: Reads): void;
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

export function createJobSession(relayUrl: string | undefined): JobSession {
  const relay: RelayClient | undefined =
    relayUrl === undefined || relayUrl === "" ? undefined : createRelayClient(relayUrl);

  let relayState: JobSessionSnapshot["relay"] = relay === undefined ? "off" : "connecting";
  let observations: SessionObservation[] = [];
  let dropped = 0;
  const meta = new Map<
    string,
    {
      endpointKey: string;
      /** The endpoint's base URL, which the job's observations are recorded against. */
      baseUrl: string;
      route: "direct" | "relay" | undefined;
      /** The read route's wrapper, when this job's endpoint is read through the relay. */
      read: FetchLike | undefined;
    }
  >();
  const listeners = new Set<(snapshot: JobSessionSnapshot) => void>();

  const snapshot = (): JobSessionSnapshot => ({
    relay: relayState,
    jobs: reconciler.jobs().map((job) => ({
      ...job,
      endpointKey: meta.get(job.statusUrl)?.endpointKey ?? "",
      route: meta.get(job.statusUrl)?.route,
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

  return {
    async endpoints() {
      return relay === undefined ? [] : relay.endpoints();
    },

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

    track(endpoint, statusUrl, reads = "direct") {
      const read = readFetch(endpoint, reads);
      meta.set(statusUrl, {
        endpointKey: endpoint.key,
        baseUrl: endpoint.baseUrl,
        route: read === undefined ? "direct" : "relay",
        read,
      });
      reconciler.track(statusUrl);
    },

    record(endpoint, observation) {
      observeFor(endpoint)(observation);
    },

    async run(endpoint, processId, inputs, outputs, description, reads = "direct") {
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
        meta.set(statusUrl, { endpointKey: endpoint.key, baseUrl: endpoint.baseUrl, route, read });
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
