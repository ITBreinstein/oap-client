/**
 * @breinstein/oap-client — a runtime-neutral OGC API - Processes client.
 *
 * ESM only, Node >=18 and modern browsers. Nothing here may import React,
 * MapLibre, application code, or a Node built-in; see the boundary and
 * runtime-neutrality rules in eslint.config.js.
 */
export { createClient } from "./client.js";
export type { Client, ClientOptions, InspectRequestOptions, RequestOptions } from "./client.js";

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
export { collectLinks, readBodyLinks } from "./links/resolve.js";
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

// Errors raised above the transport, by the layers that read documents.
export { MalformedDocumentError, MissingLinkError, NotJsonError } from "./errors.js";

// Observations: what the client saw, redacted at the point of creation.
export { observe, redactUrl } from "./observations.js";
export type {
  Observation,
  ObservationKind,
  ObservationSink,
  SkippedLinkReason,
} from "./observations.js";

/** Package version, mirrored from package.json for observation records. */
export const VERSION: string = "0.1.0";
