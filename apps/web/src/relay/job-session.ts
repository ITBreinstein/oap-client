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
  type Client,
  type ExecuteOutputSelection,
  type Execution,
  type ProcessDescription,
} from "@breinstein/oap-client";
import type { WebObservation } from "../observations.js";
import type { RelayEndpoint } from "./contract.js";
import { openDoorbells, type DoorbellStream, type StreamState } from "./doorbells.js";
import { JobReconciler, type TrackedJob } from "./reconciler.js";
import { createRelayClient, type RelayClient } from "./relay-client.js";
import { createRoutedFetch } from "./routed-fetch.js";

export interface JobRow extends TrackedJob {
  readonly endpointKey: string;
  readonly route: "direct" | "relay" | undefined;
}

export interface JobSessionSnapshot {
  readonly relay: "off" | StreamState;
  readonly jobs: readonly JobRow[];
  readonly observations: readonly WebObservation[];
}

export interface JobSession {
  endpoints(): Promise<RelayEndpoint[]>;
  /**
   * A core client for one endpoint, reporting into this session's
   * observations and sending through the same route choice as `run`. For
   * everything but an asynchronous execute: discovery, the process list and
   * descriptions, a synchronous run, results and dismissal.
   */
  client(endpoint: RelayEndpoint): Client;
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
  ): Promise<Execution>;
  /** Start reconciling a job the caller found some other way — a sync run the server made async. */
  track(endpoint: RelayEndpoint, statusUrl: string): void;
  /** Add an observation the web app made itself (T4). */
  record(observation: WebObservation): void;
  subscribe(listener: (snapshot: JobSessionSnapshot) => void): () => void;
  dispose(): void;
}

/**
 * Enough for a long demo session, bounded so a page left open for a day does
 * not grow without limit. The export button writes whatever is kept.
 */
const OBSERVATIONS_KEPT = 1_000;

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
  let observations: WebObservation[] = [];
  const meta = new Map<string, { endpointKey: string; route: "direct" | "relay" | undefined }>();
  const listeners = new Set<(snapshot: JobSessionSnapshot) => void>();

  const snapshot = (): JobSessionSnapshot => ({
    relay: relayState,
    jobs: reconciler.jobs().map((job) => ({
      ...job,
      endpointKey: meta.get(job.statusUrl)?.endpointKey ?? "",
      route: meta.get(job.statusUrl)?.route,
    })),
    observations,
  });
  const publish = (): void => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  const observe = (observation: WebObservation): void => {
    observations = [...observations.slice(1 - OBSERVATIONS_KEPT), observation];
    publish();
  };

  const reconciler = new JobReconciler({
    readJob: (statusUrl, signal) => getJob(statusUrl, { signal, onObservation: observe }),
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

  return {
    async endpoints() {
      return relay === undefined ? [] : relay.endpoints();
    },

    client(endpoint) {
      return createClient({
        baseUrl: endpoint.baseUrl,
        onObservation: observe,
        fetch: createRoutedFetch({ endpoint, relay, session: doorbells, onRoute: observe }),
      });
    },

    track(endpoint, statusUrl) {
      meta.set(statusUrl, { endpointKey: endpoint.key, route: "direct" });
      reconciler.track(statusUrl);
    },

    record(observation) {
      observe(observation);
    },

    async run(endpoint, processId, inputs, outputs, description) {
      const refs = new Map<string, string>();
      let route: "direct" | "relay" | undefined;
      const client = createClient({
        baseUrl: endpoint.baseUrl,
        onObservation: observe,
        fetch: createRoutedFetch({
          endpoint,
          relay,
          session: doorbells,
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
        meta.set(statusUrl, { endpointKey: endpoint.key, route });
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
