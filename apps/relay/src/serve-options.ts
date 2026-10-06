/**
 * The options `server.ts` passes to `serve()`, kept here so tests can start
 * a listener that behaves the same way.
 */

/**
 * `@hono/node-server` drains a POST body the handler did not read for at most
 * 500 ms after the answer, then destroys the socket. The callback route never
 * reads its body, and an OGC server can still be uploading one then: pygeoapi
 * posts a job's outputs to `successUri`, and treats a reset connection as a
 * failure of the job (finding 0047). Without the cleanup, Node itself discards
 * the rest of the body for as long as the upload takes, bounded by its
 * `requestTimeout` (review R6).
 */
export const relayServeOptions = { autoCleanupIncoming: false } as const;
