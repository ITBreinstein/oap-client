/**
 * The execution layer's public surface.
 *
 * Everything here is re-exported from the package entry point, because
 * `apps/web`'s run button and job panel branch on {@link Execution} and hold a
 * {@link JobHandle} across the boundary between this task and Task 5.
 */

export { execute } from "./execute.js";
export {
  buildHeaders,
  buildPayload,
  buildRequest,
  checkArity,
  describeInputKind,
  executionUrlFor,
  resolveExecutionUrl,
} from "./build-request.js";
export type { ExecutePayload, ExecuteRequest } from "./build-request.js";
export { classifyExecution, gatherEvidence, isJobDocument } from "./classify-execution.js";
export type { ExecutionEvidence } from "./classify-execution.js";
export { DEFAULT_EXECUTE_TIMEOUT_MS } from "./types.js";
export type {
  Execution,
  ExecuteInputValue,
  ExecuteOptions,
  ExecuteOutputSelection,
  ExecuteTransportOptions,
  ExecutionMode,
  JobHandle,
} from "./types.js";
