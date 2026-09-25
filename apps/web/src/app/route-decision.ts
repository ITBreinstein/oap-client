/**
 * Direct first, and the relay only after a click (phase 3; finding 0050).
 *
 * Pure functions, so the rules can be tested without a browser. The side
 * effects live in `useWorkflow`, and the reducer holds the one state in which
 * the relay may be tried: an open offer, left only by the user's answer.
 *
 * 1. Every connection starts direct, whatever the endpoint's configuration.
 * 2. A direct failure that looks like CORS, on an endpoint the relay offers its
 *    read route for, opens the offer. Any other failure is reported as before.
 * 3. Only "Use relay" sends anything through the relay. Any other way of
 *    closing the offer is a decline.
 * 4. Each attempt leaves one `endpoint-access` record, and its `routeUsed` is
 *    `relay` only when the relay attempt actually connected.
 */

import { redactUrl, TransportError } from "@breinstein/oap-client";
import type { EndpointAccessObservation } from "../observations.js";
import { relayRouteErrorIn, type RelayOutcome } from "../relay/relay-fetch.js";
import type { EndpointRef } from "./workflow.js";

export type DirectOutcome = EndpointAccessObservation["outcome"];

/** How a direct attempt failed. A cross-origin request with no response is what CORS looks like. */
export function directFailure(cause: unknown): Exclude<DirectOutcome, "connected"> {
  return cause instanceof TransportError && cause.crossOrigin === true ? "cors-blocked" : "failed";
}

/** Whether the relay offers its read route for this endpoint. Static: config, not outcome. */
export function relayConfigured(endpoint: EndpointRef, relayAvailable: boolean): boolean {
  return relayAvailable && endpoint.source === "configured" && endpoint.readRoute === "relay";
}

/** Whether to ask the user. Never for anything but a CORS-shaped failure. */
export function offersRelay(
  endpoint: EndpointRef,
  direct: DirectOutcome,
  relayAvailable: boolean,
): boolean {
  return direct === "cors-blocked" && relayConfigured(endpoint, relayAvailable);
}

export interface RelayAttempt {
  readonly relayOutcome: RelayOutcome;
  readonly relayReasonCode: string | undefined;
}

/** How an attempt through the relay ended. `undefined` in: it connected. */
export function relayAttempt(cause: unknown): RelayAttempt {
  if (cause === undefined) return { relayOutcome: "ok", relayReasonCode: undefined };
  const routeError = relayRouteErrorIn(cause);
  if (routeError !== undefined) {
    return { relayOutcome: routeError.outcome, relayReasonCode: routeError.code };
  }
  // The server's own answer came through the relay and the core could not use
  // it: the server was up, so the direct failure was CORS after all.
  return { relayOutcome: "other-failure", relayReasonCode: undefined };
}

export interface AttemptFacts {
  readonly endpoint: EndpointRef;
  readonly at: Date;
  readonly relayAvailable: boolean;
  readonly direct: DirectOutcome;
  /** The direct error's class name. */
  readonly directError: string | undefined;
  /** Present only when the offer was answered. */
  readonly confirmed?: boolean | undefined;
  /** Present only when the relay was tried. */
  readonly relay?: RelayAttempt | undefined;
}

/** The one record an attempt leaves. */
export function accessRecord(facts: AttemptFacts): EndpointAccessObservation {
  const { endpoint, direct, relay } = facts;
  const routeUsed =
    direct === "connected" ? "direct" : relay?.relayOutcome === "ok" ? "relay" : "none";
  return {
    kind: "endpoint-access",
    endpoint: redactUrl(endpoint.baseUrl),
    endpointKey: endpoint.source === "configured" ? endpoint.key : undefined,
    source: endpoint.source,
    at: facts.at.toISOString(),
    outcome: direct,
    error: facts.directError,
    relayConfigured: relayConfigured(endpoint, facts.relayAvailable),
    userConfirmedRelay: facts.confirmed === true,
    relayOutcome: relay?.relayOutcome,
    relayReasonCode: relay?.relayReasonCode,
    routeUsed,
  };
}

/** The class name of whatever was thrown. Never its message. */
export function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : typeof cause;
}
