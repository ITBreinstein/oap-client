/**
 * Everything the web app observes, in one union: the core's observations plus
 * the ones only the web app can make.
 *
 * Moved here from `relay/job-session.ts` once it stopped being about the relay
 * (T4). Web-local on purpose: none of these is a published type, so adding one
 * changes nothing a consumer of the core depends on.
 *
 * The rule the core follows applies here too — **redacted at creation**. An
 * observation carries ids, codes, schema keywords, CRS URIs and an endpoint's
 * origin and path. Never an input value, never a schema body, never a query
 * string, never a response body. These are exported as a file and read by
 * people other than the one who typed the values.
 */

import { redactUrl, type Observation } from "@breinstein/oap-client";
import type { EncodeNote } from "./forms/encode.js";
import type { Diagnostic, DiagnosticCode } from "./forms/plan.js";
import type { RelayOutcome } from "./relay/relay-fetch.js";
import type { ExecuteRouteObservation } from "./relay/routed-fetch.js";

/**
 * Something the form generator could not do as the schema asked, or changed on
 * the way to the wire. The raw material of the form-generation failure
 * catalogue.
 */
export interface FormObservation {
  readonly kind: "form";
  /** The endpoint, redacted: origin and path only. */
  readonly endpoint: string;
  readonly processId: string;
  /** Absent for a note about the process as a whole. */
  readonly inputId: string | undefined;
  readonly code:
    | DiagnosticCode
    | EncodeNote["code"]
    /** A bbox input offering only CRSs a map-drawn box cannot be sent in. */
    | "bbox-projected-crs-only";
  /** The schema keyword that caused a fallback: `oneOf`, `type`, `enum`, … */
  readonly keyword: string | undefined;
  /** For the bbox codes, the CRS URI involved. A URI, never a coordinate. */
  readonly crs: string | undefined;
}

/**
 * One attempt to connect to an endpoint, from the direct request to whatever
 * route was finally used. One record per attempt, written once the attempt has
 * settled: connected, failed, declined, or tried through the relay.
 *
 * The direct half is always there, which is what keeps a server that needed
 * the relay recorded as unusable from a web page.
 */
export interface EndpointAccessObservation {
  readonly kind: "endpoint-access";
  readonly endpoint: string;
  /** The relay's key for a configured endpoint; `undefined` for a typed address. */
  readonly endpointKey: string | undefined;
  /** Configured on the relay, or typed into the page. */
  readonly source: "configured" | "typed";
  /** When the attempt started, ISO 8601. */
  readonly at: string;
  /**
   * The **direct** attempt, always made first:
   *
   * - `connected`: the landing page and the process list were read.
   * - `cors-blocked`: the request never produced a readable response, from a
   *   page on another origin — what a missing `Access-Control-Allow-Origin`
   *   looks like from inside a browser (findings 0049, 0050). A server that is
   *   down looks the same; a relay attempt that reaches it tells them apart.
   * - `failed`: any other failure; `error` names its class.
   */
  readonly outcome: "connected" | "cors-blocked" | "failed";
  /** The direct error's class name. Never its message, which may carry a URL. */
  readonly error: string | undefined;
  /** Whether the relay offers its read route for this endpoint at all. */
  readonly relayConfigured: boolean;
  /** Whether the user clicked "Use relay". Nothing is sent through it otherwise. */
  readonly userConfirmedRelay: boolean;
  /**
   * The relay attempt, when there was one. `other-failure` means the server's
   * own answer came back and could not be used, so the server was up.
   */
  readonly relayOutcome: RelayOutcome | undefined;
  /** The relay's reason code, verbatim (`timeout`, `blocked-address`, …), or ours. */
  readonly relayReasonCode: string | undefined;
  /** `relay` only when the relay attempt succeeded; `none` when nothing connected. */
  readonly routeUsed: "direct" | "relay" | "none";
}

/**
 * A "Cancel job" attempt, and whether dismissal had been advertised. The pair
 * is the matrix's declared-versus-observed split for dismissal (T6).
 */
export interface CancelJobObservation {
  readonly kind: "cancel-job";
  readonly endpoint: string;
  readonly processId: string;
  /** Where the client learned dismissal might work, if anywhere. */
  readonly advertisedBy: "process" | "service" | "observed-earlier" | "nothing";
  readonly outcome: "dismissed" | "unsupported" | "failed";
}

export type WebObservation =
  | Observation
  | ExecuteRouteObservation
  | FormObservation
  | EndpointAccessObservation
  | CancelJobObservation;

export function formObservationsFor(
  endpoint: string,
  processId: string,
  diagnostics: readonly Diagnostic[],
): FormObservation[] {
  return diagnostics.map((diagnostic) => ({
    kind: "form",
    endpoint: redactUrl(endpoint),
    processId,
    inputId: diagnostic.inputId,
    code: diagnostic.code,
    keyword: diagnostic.keyword,
    crs: undefined,
  }));
}

/**
 * One observation, and the endpoint it was made against: its base URL,
 * redacted. Attributed when recorded, because several core observations carry
 * no URL (`capabilities-derived`) and the rest carry one that says nothing
 * about which endpoint was being read.
 */
export interface SessionObservation {
  readonly endpoint: string;
  readonly observation: WebObservation;
}

/** The endpoints a session has observations for, in the order first seen. */
export function observedEndpoints(entries: readonly SessionObservation[]): string[] {
  return [...new Set(entries.map((entry) => entry.endpoint))];
}

/** How many observations of each kind, most frequent first, then by name. */
export function kindCounts(
  entries: readonly SessionObservation[],
): { readonly kind: WebObservation["kind"]; readonly count: number }[] {
  const counts = new Map<WebObservation["kind"], number>();
  for (const { observation } of entries) {
    counts.set(observation.kind, (counts.get(observation.kind) ?? 0) + 1);
  }
  return [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * What the download buttons write. With `endpoint`, only that endpoint's
 * observations, and the file names it: one file per endpoint is what the
 * interoperability matrix is built from. Without it, the whole session.
 *
 * `droppedObservations` is the session's, since which endpoint a dropped one
 * belonged to is gone with it. Present only when something was dropped, so a
 * file that has it is known to be incomplete.
 */
export function observationExport(
  entries: readonly SessionObservation[],
  coreVersion: string,
  options: { readonly now?: Date; readonly endpoint?: string; readonly dropped?: number } = {},
): string {
  const { now = new Date(), endpoint, dropped = 0 } = options;
  const observations = entries
    .filter((entry) => endpoint === undefined || entry.endpoint === endpoint)
    .map((entry) => entry.observation);
  return JSON.stringify(
    {
      exportedAt: now.toISOString(),
      coreVersion,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(dropped === 0 ? {} : { droppedObservations: dropped }),
      observations,
    },
    null,
    2,
  );
}
