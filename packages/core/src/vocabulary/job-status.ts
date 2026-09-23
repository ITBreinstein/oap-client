/**
 * The OGC job status vocabulary, and the two questions anyone asks of it.
 *
 * ## Why this is its own module and not part of `jobs/`
 *
 * Two layers need this list. `jobs/` needs it to decide whether a job is
 * terminal; `execution/` needs it to tell a job document from a result, which
 * is the evidence `classifyExecution()` reads when a server answers 200 with a
 * job rather than a 201 (see `execution/classify-execution.ts`). Two copies of
 * one vocabulary eventually disagree, so there is one.
 *
 * It used to live in `jobs/types.ts`, reached from `execution/` through a
 * file-level exemption in `.dependency-cruiser.cjs`. That exemption was the
 * wrong fix: it made the *rule* accommodate the dependency instead of making
 * the dependency point somewhere defensible. Note in particular that the thing
 * crossing the boundary is {@link isJobState} — a function, not a type — so no
 * amount of `import type` would have made the edge disappear at runtime.
 *
 * So the vocabulary sits below both layers instead, in a module that imports
 * nothing at all from `packages/core`. That is enforced, not merely intended:
 * `vocabulary-imports-nothing` in `.dependency-cruiser.cjs`. A module that
 * everyone may depend on has to be a module that depends on no one, or it is
 * just a cycle with extra steps.
 *
 * What is deliberately **not** here: {@link JobStatus} and the rest of
 * `jobs/types.ts`. Those reference `Link` and `ProblemDetails`, so moving them
 * would drag `links/` and `http/` in behind them and break the very rule this
 * module exists to satisfy. The vocabulary is the part both layers share; the
 * document shape is the part only `jobs/` owns.
 */

/**
 * The OGC job status vocabulary, verbatim per the house naming rule.
 *
 * Spelled out again in `observations.ts` rather than imported, because that
 * module is a leaf every layer depends on and importing even from here would
 * make it depend on something. That duplication is deliberate and is the only
 * one.
 */
export type JobState = "accepted" | "running" | "successful" | "failed" | "dismissed";

const JOB_STATES: ReadonlySet<string> = new Set<JobState>([
  "accepted",
  "running",
  "successful",
  "failed",
  "dismissed",
]);

/**
 * The statuses a job cannot leave.
 *
 * `dismissed` is terminal even though both reference servers delete the job
 * outright rather than parking it in that state (finding 0035) — a server that
 * *does* keep it must not be polled forever.
 */
const TERMINAL_STATES: ReadonlySet<string> = new Set<JobState>([
  "successful",
  "failed",
  "dismissed",
]);

/** Is this string in the OGC job status vocabulary? Case-insensitive: servers are inconsistent. */
export function isJobState(value: string): value is JobState {
  return JOB_STATES.has(value.toLowerCase());
}

/** Is this a status the job cannot leave? Unknown statuses are **not** terminal. */
export function isTerminalState(value: string): boolean {
  return TERMINAL_STATES.has(value.toLowerCase());
}
