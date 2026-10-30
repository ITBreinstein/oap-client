/**
 * Waits for work a user would wait for too, named for what they wait for
 * (reliability task, 2026-10-26). Everything else keeps the 5 s default.
 */

/**
 * Connecting to a service: five requests in a row — the landing page,
 * conformance, both again, and the process list — before the list is on
 * screen. On a loaded machine each took up to 3.6 s in step zero, and the
 * whole of it went past 5 s.
 */
export const CONNECTED = { timeout: 15_000 } as const;
