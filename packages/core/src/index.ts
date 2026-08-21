/**
 * @breinstein/ogcapi-processes-core — a runtime-neutral OGC API - Processes client.
 *
 * ESM only, Node >=18 and modern browsers. Nothing here may import React,
 * MapLibre, application code, or a Node built-in; see the boundary and
 * runtime-neutrality rules in eslint.config.js.
 */
export { createClient } from "./client.js";
export type { Client, ClientOptions } from "./client.js";
export type { FetchLike } from "./http/fetch.js";
export { OgcApiError } from "./errors/ogc-api-error.js";
export type { ProblemDetails } from "./errors/ogc-api-error.js";

/** Package version, mirrored from package.json for observation records. */
export const VERSION: string = "0.1.0";
