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

/** How connecting to an endpoint went, and where the address came from (T8). */
export interface EndpointAccessObservation {
  readonly kind: "endpoint-access";
  readonly endpoint: string;
  /** Configured on the relay, or typed into the page. */
  readonly source: "configured" | "typed";
  /**
   * - `connected`: the landing page and the process list were read.
   * - `cors-blocked`: the request never produced a readable response, from a
   *   page on another origin — what a missing `Access-Control-Allow-Origin`
   *   looks like from inside a browser (findings 0049, 0050).
   * - `failed`: any other failure; `error` names its class.
   */
  readonly outcome: "connected" | "cors-blocked" | "failed";
  /** The error's class name. Never its message, which may carry a URL. */
  readonly error: string | undefined;
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

/** What the "Download session observations" button writes. */
export function observationExport(
  observations: readonly WebObservation[],
  coreVersion: string,
  now: Date = new Date(),
): string {
  return JSON.stringify({ exportedAt: now.toISOString(), coreVersion, observations }, null, 2);
}
