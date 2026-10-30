/**
 * OGC API - Processes - Part 1: Core 2.0, **the draft** (OGC 18-062r3), as far
 * as this client speaks it.
 *
 *     Source   https://github.com/opengeospatial/ogcapi-processes/tree/756b65935bee47ebc4b460ab8213a7fb378af542/core
 *     Commit   756b65935bee47ebc4b460ab8213a7fb378af542 (2026-10-20)
 *     Written  2026-10-23
 *     Against  Weaver (pavics/weaver, latest-manager, 6.16.0 plus master),
 *              the one server found that declares the draft's Core class
 *
 * Per the architecture plan (§6.4): draft differences live in this one dated
 * module, and only the ones a real service or an agreed fixture required. It
 * is not a framework. When the draft moves, this file is re-read against the
 * new commit, and its date says how stale it may be.
 *
 * ## What differs, and where each difference is handled
 *
 * Only the execute request **body** differs in what the client sends. It is
 * the one thing here: {@link draftExecuteOptions}. Everything the client
 * *reads* is classified by what arrives, whatever the version, so the other
 * differences are tolerance changes that hold for 1.0 servers too, in the
 * module that reads each document:
 *
 * - the status document's new members (`processingEntityType`, …) — read
 *   or recorded by name in `vocabulary/job-status.ts`;
 * - exception types written as `https://` and the two new ones — matched in
 *   `http/problem.ts`;
 * - `Preference-Applied` — its tokens recorded for every version.
 *
 * ## Not supported
 *
 * - `Prefer: return=minimal|representation`. In the draft it decides only
 *   whether values inside a JSON results document come inline or as links,
 *   and only as a recommendation; the client sends no `return=` at all.
 * - Asking for one output wrapped as a document, which the draft allows only
 *   through content negotiation by profile (`ogc-results`). Not sent.
 * - The new per-output endpoints, `/jobs/{jobID}/results/{outputID}[/{N}]`.
 * - Parts 2, 3 and 4: deploying processes, workflows and job management.
 */

import { DraftUnsupportedRequestError } from "../errors.js";
import type { ExecuteOptions } from "../execution/types.js";
import type { OutputDescription } from "../processes/types.js";

/** The draft this module was written against. */
export const PROCESSES_2_0_DRAFT: Readonly<{
  document: string;
  commit: string;
  committed: string;
  written: string;
}> = Object.freeze({
  document: "OGC 18-062r3",
  commit: "756b65935bee47ebc4b460ab8213a7fb378af542",
  committed: "2026-10-20",
  written: "2026-10-23",
});

/**
 * The outputs a request asks for, explicitly or not: the `outputs` block's
 * ids when one is sent, else every output of the description, which is what
 * the draft returns for an omitted block (`/req/core/process-execute-omitted-outputs`).
 * Undefined when there is neither to count.
 */
function requestedOutputs(options: ExecuteOptions): readonly string[] | undefined {
  if (options.outputs !== undefined) return Object.keys(options.outputs);
  return options.description?.outputs.map((output) => output.id);
}

/** An output's description by id, when there is a description to look in. */
function described(options: ExecuteOptions, id: string): OutputDescription | undefined {
  return options.description?.outputs.find((output) => output.id === id);
}

/**
 * The caller's request, as the draft says it. Throws
 * {@link DraftUnsupportedRequestError} for one it cannot say, **before
 * anything is sent**.
 *
 * `ExecuteOptions` stays as it is for callers, in 1.0's words; this is where
 * they are translated:
 *
 * | Asked                       | Sent in the draft                                  |
 * | --------------------------- | -------------------------------------------------- |
 * | nothing (no `response`)     | the same body: nothing extra                       |
 * | `response: "raw"`           | no `response`; exactly one output, `maxOccurs` 1   |
 * | `response: "document"`      | no `response`; two or more outputs                 |
 * | a `transmissionMode`        | refused: the draft has none                        |
 *
 * Raw and document are what the draft returns for that number of outputs —
 * one requested output with `maxOccurs` 1 comes back as its value
 * (`/req/core/process-execute-sync-one`), two or more as a results document
 * (`/req/core/process-execute-sync-many-json`) — so the caller's meaning is
 * kept by checking the count, not by sending a member the draft removed. An
 * output whose description is missing is taken to have the draft's default
 * `maxOccurs` of 1.
 */
export function draftExecuteOptions(options: ExecuteOptions): ExecuteOptions {
  for (const [id, selection] of Object.entries(options.outputs ?? {})) {
    if (selection.transmissionMode !== undefined) {
      throw new DraftUnsupportedRequestError(selection.transmissionMode, "no-transmission-mode", [
        id,
      ]);
    }
  }

  const { response, ...rest } = options;
  if (response === undefined) return options;

  const requested = requestedOutputs(options);
  if (requested === undefined) {
    throw new DraftUnsupportedRequestError(response, "outputs-unknown", []);
  }

  if (response === "document" && requested.length < 2) {
    throw new DraftUnsupportedRequestError(response, "document-needs-several-outputs", requested);
  }

  if (response === "raw") {
    const [only] = requested;
    if (requested.length !== 1 || only === undefined) {
      throw new DraftUnsupportedRequestError(response, "raw-needs-one-output", requested);
    }
    if (described(options, only)?.multiple === true) {
      throw new DraftUnsupportedRequestError(response, "raw-needs-single-valued-output", requested);
    }
  }

  return rest;
}
