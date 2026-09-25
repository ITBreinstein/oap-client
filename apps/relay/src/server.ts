/**
 * The relay process: read the config, start listening, sweep expired state.
 *
 *   RELAY_CONFIG  path to the JSON config (see config.ts; examples in
 *                 infra/relay/). Without it the relay starts with no endpoints
 *                 and can only answer its health check.
 *   PORT          default 8787
 *   HOST          default: every interface, IPv6 and IPv4 where the host has
 *                 both (Node's own default). The OGC servers must be able to
 *                 reach the callback routes, and in CI they do so from a
 *                 container, whose `host.docker.internal` may resolve to
 *                 either family.
 *
 * Nothing here logs a request. Paths carry callback tokens, and a relay that
 * never writes a path down cannot leak one that way.
 */

import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { RelayState, systemClock } from "./state.js";

const SWEEP_INTERVAL_MS = 60_000;
const IDLE_SOCKET_TIMEOUT_MS = 60_000;
/** Lets the relay's own deadline fire, and answer, before the socket's does. */
const DEADLINE_MARGIN_MS = 10_000;

const configPath = process.env["RELAY_CONFIG"];
const rawConfig: unknown =
  configPath === undefined ? { endpoints: [] } : JSON.parse(readFileSync(configPath, "utf8"));
const config = parseConfig(rawConfig);

const state = new RelayState(systemClock, {
  registrationTtlMs: config.registrationTtlMs,
  sessionIdleTtlMs: config.sessionIdleTtlMs,
  maxSessions: config.limits.maxSessions,
  maxRegistrationsPerSession: config.limits.maxRegistrationsPerSession,
});

const port = Number(process.env["PORT"] ?? 8787);
const hostname = process.env["HOST"];

const server = serve({
  fetch: createApp({ config, state }).fetch,
  port,
  ...(hostname === undefined ? {} : { hostname }),
});
// A slow sender cannot hold a socket for ever. Callback bodies are never read,
// but Node drains them after we answer, and this bounds that too. It is an
// idle timeout, and a forwarded request sends the browser nothing until the
// server answers, so it stays above the relay's own upstream deadlines: below
// them, a slow synchronous execute would be cut off here first, and the page
// would read that as the relay being down.
server.setTimeout(
  Math.max(IDLE_SOCKET_TIMEOUT_MS, config.limits.readTimeoutMs, config.limits.upstreamTimeoutMs) +
    DEADLINE_MARGIN_MS,
);

const sweeper = setInterval(() => state.sweep(), SWEEP_INTERVAL_MS);
sweeper.unref();

const shutdown = (): void => {
  clearInterval(sweeper);
  server.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(
  `relay listening on ${hostname ?? "*"}:${String(port)} with ${String(config.endpoints.length)} endpoint(s)`,
);
