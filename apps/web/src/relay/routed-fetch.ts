/**
 * Route B, as a `fetch` the core can be handed.
 *
 * The core stays exactly as it is: it builds the execute request, sends it
 * through whatever `fetch` it was given, and classifies the response from its
 * own evidence. This wrapper decides — **before anything is sent** — whether
 * an execute goes straight to the OGC server or through the relay, and in the
 * relay case turns the relay's answer back into the `Response` the server
 * gave, `Location` included. The core then finds the job by the header, as it
 * would from Node.
 *
 * ## The route is chosen once, and never retried on the other one
 *
 * Execute is not idempotent. A direct attempt whose response the browser could
 * not read has still created a job on the server; retrying it through the
 * relay would create a second and orphan the first. So the choice comes from
 * the endpoint's configuration and the requested mode, both known before the
 * request exists, and a failure on the chosen route is reported, not rerouted.
 *
 * - `executeRoute: "relay"` and an asynchronous execute → the relay.
 * - anything else → straight through. Synchronous execution does not need
 *   `Location`; its answer is the body, and the browser can read that itself
 *   wherever the server sends CORS headers.
 *
 * The one retry there is: when the relay refuses *before sending anything
 * upstream* because it does not know the session — which is what a relay
 * restart looks like — a new session is fetched and the same request is sent
 * to the relay once more. No job can exist after that refusal, so no job can
 * be duplicated by the retry.
 */

import type { FetchLike } from "@breinstein/oap-client";
import type { RelayedExecute, RelayEndpoint } from "./contract.js";
import { RelayError, type RelayClient } from "./relay-client.js";

/**
 * Which route one execute took, recorded whether it worked or not. It is how
 * the matrix tells a job a browser could name by itself apart from one the
 * relay named for it.
 */
export interface ExecuteRouteObservation {
  readonly kind: "execute-route";
  readonly endpointKey: string;
  readonly route: "direct" | "relay";
  readonly requestedMode: "sync" | "async";
  /**
   * - `sent`: the request reached the chosen route and an answer came back.
   * - `refused`: this client would not send it — an execute URL the relay
   *   cannot carry. Nothing was sent anywhere.
   * - `relay-refused`: the relay refused before contacting the OGC server.
   * - `relay-failed`: the relay tried and failed; a job may exist.
   */
  readonly outcome: "sent" | "refused" | "relay-refused" | "relay-failed";
  /** Relay route only: whether the OGC server's answer carried `Location`. */
  readonly locationPresent: boolean | undefined;
  readonly callbacksRegistered: boolean;
  /** The core's execute URL carried a query the relay does not forward. */
  readonly queryDropped: boolean;
  /** The relay's reason code, for the two relay outcomes. */
  readonly reason: string | undefined;
}

/** Where the relay session comes from. The doorbell stream owns it. */
export interface SessionSource {
  current(): string | undefined;
  /** A fresh session after the relay forgot the last one. */
  renew(): Promise<string | undefined>;
}

export interface RoutedFetchOptions {
  readonly endpoint: RelayEndpoint;
  /** Without a relay every request goes straight through. */
  readonly relay: RelayClient | undefined;
  readonly session?: SessionSource | undefined;
  readonly fetch?: FetchLike | undefined;
  readonly onRoute?: ((observation: ExecuteRouteObservation) => void) | undefined;
  /**
   * A job was started with callbacks registered under `ref`. `statusUrl` is
   * `Location` resolved against the execute URL — the same resolution the core
   * applies, so it equals the `JobHandle.statusUrl` the core hands back.
   */
  readonly onRegistration?: ((ref: string, statusUrl: string | undefined) => void) | undefined;
}

/** Statuses that may not carry a body, which `new Response` refuses one for. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  if (init?.headers === undefined) return undefined;
  return new Headers(init.headers).get(name) ?? undefined;
}

export function createRoutedFetch(options: RoutedFetchOptions): FetchLike {
  const { endpoint, relay } = options;
  const direct: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const executePath = new RegExp(`^${escapeRegExp(endpoint.baseUrl)}/processes/([^/]+)/execution$`);

  const record = (observation: ExecuteRouteObservation): void => {
    try {
      options.onRoute?.(observation);
    } catch {
      // A recorder must not be able to break an execution.
    }
  };

  return async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "POST") return direct(input, init);

    const url = new URL(input);
    const match = executePath.exec(`${url.origin}${url.pathname}`);
    if (match?.[1] === undefined) return direct(input, init);

    const requestedMode: "sync" | "async" = /respond-async/i.test(headerValue(init, "Prefer") ?? "")
      ? "async"
      : "sync";
    const base = { endpointKey: endpoint.key, requestedMode, queryDropped: url.search !== "" };

    if (relay === undefined || endpoint.executeRoute !== "relay" || requestedMode === "sync") {
      const response = await direct(input, init);
      record({
        ...base,
        kind: "execute-route",
        route: "direct",
        outcome: "sent",
        locationPresent: undefined,
        callbacksRegistered: false,
        queryDropped: false,
        reason: undefined,
      });
      return response;
    }

    const body = init?.body;
    if (typeof body !== "string") {
      record({
        ...base,
        kind: "execute-route",
        route: "relay",
        outcome: "refused",
        locationPresent: undefined,
        callbacksRegistered: false,
        reason: "body-not-text",
      });
      throw new TypeError("the relay route carries JSON text bodies only");
    }

    const processId = decodeURIComponent(match[1]);
    const signal = init?.signal ?? undefined;
    const send = (session: string | undefined) =>
      relay.execute(endpoint.key, processId, body, session, signal);

    let answer: RelayedExecute;
    try {
      try {
        answer = await send(options.session?.current());
      } catch (error) {
        if (
          !(error instanceof RelayError) ||
          error.status !== 401 ||
          options.session === undefined
        ) {
          throw error;
        }
        answer = await send(await options.session.renew());
      }
    } catch (error) {
      const refused = error instanceof RelayError && error.beforeUpstream;
      record({
        ...base,
        kind: "execute-route",
        route: "relay",
        outcome: refused ? "relay-refused" : "relay-failed",
        locationPresent: undefined,
        callbacksRegistered: false,
        reason: error instanceof RelayError ? error.code : "unreachable",
      });
      // A TypeError is what `fetch` throws for a request that produced no
      // response, and it is what the core's transport turns into a
      // TransportError. The relay's reason rides along as the cause.
      throw new TypeError(
        `relay route failed: ${error instanceof RelayError ? error.code : "unreachable"}`,
        {
          cause: error,
        },
      );
    }

    const { upstream, ref } = answer;
    record({
      ...base,
      kind: "execute-route",
      route: "relay",
      outcome: "sent",
      locationPresent: upstream.location !== undefined,
      callbacksRegistered: ref !== undefined,
      reason: undefined,
    });
    if (ref !== undefined) {
      options.onRegistration?.(
        ref,
        upstream.location === undefined ? undefined : new URL(upstream.location, input).toString(),
      );
    }

    const headers = new Headers();
    if (upstream.location !== undefined) headers.set("Location", upstream.location);
    if (upstream.contentType !== undefined) headers.set("Content-Type", upstream.contentType);
    if (upstream.preferenceApplied !== undefined) {
      headers.set("Preference-Applied", upstream.preferenceApplied);
    }
    return new Response(NULL_BODY_STATUSES.has(upstream.status) ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  };
}
