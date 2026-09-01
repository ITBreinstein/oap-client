/**
 * @breinstein/oap-client — a runtime-neutral OGC API - Processes client.
 *
 * ESM only, Node >=18 and modern browsers. Nothing here may import React,
 * MapLibre, application code, or a Node built-in; see the boundary and
 * runtime-neutrality rules in eslint.config.js.
 */
export { createClient } from "./client.js";
export type {
  Client,
  ClientOptions,
  ExecuteRequestOptions,
  GetProcessRequestOptions,
  InspectRequestOptions,
  ListRequestOptions,
  RequestOptions,
} from "./client.js";

// The HTTP boundary. `src/http/` is the only place in the core that may call
// fetch; everything above it works in terms of envelopes and classifications.
export { send } from "./http/transport.js";
export type { SendOptions } from "./http/transport.js";
export { createEnvelope, DEFAULT_MAX_BUFFER_BYTES } from "./http/envelope.js";
export type { EnvelopeOptions, ResponseEnvelope } from "./http/envelope.js";
export { BODY_PREVIEW_LIMIT, classify, requireOk } from "./http/classify.js";
export type {
  Classification,
  ClassificationKind,
  ExceptionClassification,
  HttpErrorClassification,
  OkClassification,
} from "./http/classify.js";
export { toProblemDetails } from "./http/problem.js";
export type { ProblemContext, ProblemDetails } from "./http/problem.js";
export { AbortError, BodyTooLargeError, ProcessesError, TransportError } from "./http/errors.js";
export { isJsonMediaType, parseMediaType } from "./http/media-type.js";
export type { ParsedMediaType } from "./http/media-type.js";
export type { WebLink } from "./http/link-header.js";
export type { FetchLike } from "./http/fetch.js";

// Links. Everything above the transport navigates by these rather than by
// concatenating paths onto the base URL — a server is free to mount its API
// wherever it likes, and only it knows where that is.
export { collectLinks, readBodyLinks, resolveBodyLinks } from "./links/resolve.js";
export { findLink, findLinks, requireLink } from "./links/find.js";
export { aliasesFor, matchesRelation } from "./links/types.js";
export type { KnownRelation, Link } from "./links/types.js";

// Discovery.
export { inspect } from "./discovery/inspect.js";
export type { InspectOptions, ServiceDescription } from "./discovery/inspect.js";
export { parseLandingPage } from "./discovery/landing-page.js";
export type { LandingPage } from "./discovery/landing-page.js";
export {
  FORMAT_JSON,
  FORMAT_PARAM,
  JSON_ACCEPT,
  fetchJson,
  requireJson,
  withFormatJson,
} from "./discovery/negotiate.js";
export type { FetchJsonOptions, JsonDocument } from "./discovery/negotiate.js";

// Conformance.
export { parseConformance, parseConformanceUri } from "./conformance/parse.js";
export type { ConformanceClass, ParsedConformance } from "./conformance/parse.js";
export { deriveCapabilities, unknownCapabilities } from "./conformance/capabilities.js";
export type { ServiceCapabilities } from "./conformance/capabilities.js";

// Processes: the list and the description, and the types the whole product —
// the generated form, the draw tool, the execute body, the result renderers —
// is built on. Preservative, never interpretive: what to *do* with an input
// schema is `apps/web`'s decision, and this layer's job is to lose nothing it
// will need to make it.
export {
  DEFAULT_MAX_OCCURS,
  DEFAULT_MAX_PAGES,
  DEFAULT_MIN_OCCURS,
  UNBOUNDED,
  deriveExecution,
  getProcess,
  listProcesses,
  normaliseCardinality,
  parseDescription,
  parseSummary,
  processUrlFor,
  resolveProcessUrl,
} from "./processes/index.js";
export type {
  Cardinality,
  CardinalityWarning,
  GetProcessOptions,
  InputDescription,
  JsonSchema,
  ListProcessesOptions,
  NormalisedCardinality,
  OutputDescription,
  ParseDescriptionOptions,
  ParseReport,
  ParseSummaryOptions,
  ParsedDescription,
  ProcessDescription,
  ProcessExecutionOptions,
  ProcessList,
  ProcessListTruncation,
  ProcessSummary,
  ResolutionRoute,
  SchemaShapeCensus,
} from "./processes/index.js";

// Execution: the single POST that runs a process. Returns the *envelope*, not
// a parsed body — the correct parse depends on a media type the core has no
// opinion about, and §7.3 gives that decision to `apps/web`'s result adapters.
// Both arms of `Execution` and the `JobHandle` are exported now, in this task,
// so the run button and the job panel compile against them before Task 5 gives
// `JobHandle` its methods.
export {
  DEFAULT_EXECUTE_TIMEOUT_MS,
  buildHeaders,
  buildPayload,
  buildRequest,
  checkArity,
  classifyExecution,
  describeInputKind,
  execute,
  executionUrlFor,
  gatherEvidence,
  isJobDocument,
  resolveExecutionUrl,
} from "./execution/index.js";
export type {
  ExecuteInputValue,
  ExecuteOptions,
  ExecuteOutputSelection,
  ExecutePayload,
  ExecuteRequest,
  ExecuteTransportOptions,
  Execution,
  ExecutionEvidence,
  ExecutionMode,
  JobHandle,
} from "./execution/index.js";

// Errors raised above the transport, by the layers that read documents.
export {
  AmbiguousExecutionResponseError,
  ExecutionTimeoutError,
  MalformedDocumentError,
  MalformedProcessDocumentError,
  MissingLinkError,
  NotJsonError,
  ProcessNotFoundError,
} from "./errors.js";

// Observations: what the client saw, redacted at the point of creation.
export { observe, redactUrl } from "./observations.js";
export type {
  ExecutionOutcome,
  Observation,
  ObservationKind,
  ObservationSink,
  SkippedLinkReason,
} from "./observations.js";

/** Package version, mirrored from package.json for observation records. */
export const VERSION: string = "0.1.0";
