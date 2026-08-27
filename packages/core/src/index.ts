/**
 * @breinstein/oap-client — a runtime-neutral OGC API - Processes client.
 *
 * ESM only, Node >=18 and modern browsers. Nothing here may import React,
 * MapLibre, application code, or a Node built-in; see the boundary and
 * runtime-neutrality rules in eslint.config.js.
 */
export { createClient } from "./client.js";
export type { Client, ClientOptions, RequestOptions } from "./client.js";

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

// Form generation. The plan is plain data: the core decides which control an
// input needs and renders nothing, so a viewer — ours or anyone else's — can
// consume it without inheriting a framework.
export type { InputDescription, ProcessDescription } from "./processes/description.js";
export { resolveFormPlan } from "./forms/resolve.js";
export { toExecuteBody, toExecuteRequest } from "./forms/encode.js";
export type { ByReference, ExecuteBody, ExecuteOptions, FormValues } from "./forms/encode.js";
export type {
  BboxControl,
  CheckboxControl,
  Control,
  Diagnostic,
  DiagnosticCode,
  FieldPlan,
  FormPlan,
  GeometryControl,
  GeometryType,
  GeometryWrapper,
  JsonControl,
  ListControl,
  NumberControl,
  Option,
  SelectControl,
  TextControl,
} from "./forms/plan.js";

/** Package version, mirrored from package.json for observation records. */
export const VERSION: string = "0.1.0";
