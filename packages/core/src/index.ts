/**
 * @breinstein/ogcapi-processes — a runtime-neutral OGC API - Processes client.
 *
 * Nothing here may import React, MapLibre, or application code; see §5 of the
 * architecture plan and the boundary rules in eslint.config.js.
 */
export { OgcApiError } from "./errors/ogc-api-error.js";
export type { ProblemDetails } from "./errors/ogc-api-error.js";

/** Package version, mirrored from package.json for observation records. */
export const VERSION: string = "0.1.0";
