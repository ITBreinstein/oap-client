/**
 * What `server.ts` does to the listener, kept apart from the process so it can
 * be tested without starting one.
 */

import type { ServerType } from "@hono/node-server";
import type { RelayLimits } from "./config.js";

/** Headroom over the longest upstream deadline, so the relay's own 502 or 504 reaches the browser first. */
const SOCKET_TIMEOUT_MARGIN_MS = 10_000;

/** Node's timers hold a signed 32-bit millisecond count; anything longer fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * How long a browser's socket may sit silent. A read, or a synchronous
 * execute, sends nothing until the upstream answers, so this has to outlast
 * the longest upstream deadline. At a fixed 60 s it cut reads that the 120 s
 * read deadline allowed, with no status and no `X-Relay` (review R4). Slow
 * senders are still bounded by Node's `headersTimeout` and `requestTimeout`.
 */
export function socketTimeoutMs(
  limits: Pick<RelayLimits, "readTimeoutMs" | "upstreamTimeoutMs">,
): number {
  return Math.min(
    Math.max(limits.readTimeoutMs, limits.upstreamTimeoutMs) + SOCKET_TIMEOUT_MARGIN_MS,
    MAX_TIMER_MS,
  );
}

/**
 * Stops the listener now, open event streams included. `close()` alone waits
 * for every open connection to end, and an event stream never does: with one
 * browser tab open the relay ignored SIGTERM until it was killed (review R5).
 * A read still in flight is cut as well; the web client takes a dropped
 * connection for a failed read. `exit` runs after `forceAfterMs` only if
 * something else still holds the process open.
 */
export function stopListening(server: ServerType, exit: () => void, forceAfterMs = 5_000): void {
  server.close();
  if ("closeAllConnections" in server) server.closeAllConnections();
  setTimeout(exit, forceAfterMs).unref();
}
