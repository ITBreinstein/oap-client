/**
 * Whether the server did what the execute request asked, as far as the
 * response shows. Recorded on the `execution` observation; see
 * {@link PreferenceOutcome} for what each value means.
 *
 * Kept apart from the classifier on purpose. The classifier decides what the
 * answer *is* and never looks at what was asked; this compares the two, and
 * only after the classifier has decided.
 */

import type { PreferenceOutcome } from "../observations.js";
import type { ExecutionMode } from "./types.js";

/** What the classifier made of a successful response. */
export interface ClassifiedAnswer {
  /**
   * `unreachable-job`: the evidence says a job was created but offers no way to
   * reach it — what `classifyExecution` throws `AmbiguousExecutionResponseError`
   * for.
   */
  readonly kind: "immediate" | "job" | "unreachable-job";
  readonly status: number;
  /** A `Location` header the client could read. */
  readonly locationPresent: boolean;
}

export function preferenceOutcome(
  requestedMode: ExecutionMode,
  answer: ClassifiedAnswer,
): PreferenceOutcome {
  const created = answer.status === 201 || answer.status === 202;
  if (requestedMode === "async") {
    if (answer.kind === "immediate") return "ignored";
    return answer.kind === "job" && created && answer.locationPresent ? "honoured" : "ambiguous";
  }
  if (answer.kind === "immediate") return answer.locationPresent ? "ambiguous" : "honoured";
  return "ambiguous";
}
