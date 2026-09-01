/**
 * The process layer's public surface.
 *
 * Everything here is re-exported from the package entry point, because
 * `apps/web` builds its endpoint screen, its process list and its whole form
 * generator against these types.
 */

export { listProcesses, DEFAULT_MAX_PAGES } from "./list-processes.js";
export type { ListProcessesOptions } from "./list-processes.js";
export { getProcess, processUrlFor, resolveProcessUrl } from "./get-process.js";
export type { GetProcessOptions } from "./get-process.js";
export { parseDescription } from "./parse-description.js";
export type { ParseDescriptionOptions, ParsedDescription } from "./parse-description.js";
export { parseSummary, deriveExecution } from "./parse-summary.js";
export type { ParseSummaryOptions, ParseReport } from "./parse-summary.js";
export {
  DEFAULT_MAX_OCCURS,
  DEFAULT_MIN_OCCURS,
  UNBOUNDED,
  normaliseCardinality,
} from "./cardinality.js";
export type { Cardinality, CardinalityWarning, NormalisedCardinality } from "./cardinality.js";
export type {
  InputDescription,
  JsonSchema,
  OutputDescription,
  ProcessDescription,
  ProcessExecutionOptions,
  ProcessList,
  ProcessListTruncation,
  ProcessSummary,
  ResolutionRoute,
  SchemaShapeCensus,
} from "./types.js";
