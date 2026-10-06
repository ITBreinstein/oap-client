/**
 * The relay process: read the config, start listening, sweep expired state.
 *
 *   RELAY_CONFIG  path to the JSON config (see config.ts; examples in
 *                 infra/relay/). Without it the relay starts with no endpoints
 *                 and can only answer its health check.
 *   RELAY_ALLOW_PRIVATE_ADDRESSES
 *                 `1` lets endpoints that set `allowPrivateNetwork` start;
 *                 without it such a config refuses to. Local development and
 *                 CI only; warned about loudly at startup.
 *   PORT          default 8787
 *   HOST          default: every interface, IPv6 and IPv4 where the host has
 *                 both (Node's own default). The OGC servers must be able to
 *                 reach the callback routes, and in CI they do so from a
 *                 container, whose `host.docker.internal` may resolve to
 *                 either family.
 *   RELAY_BUILD_ID
 *                 optional: reported on `/healthz` as `build`, so the browser
 *                 test lane can tell a relay built from its own checkout from
 *                 one left running from another (e2e/global-setup.ts).
 *
 * Nothing here logs a request. Paths carry callback tokens, and a relay that
 * never writes a path down cannot leak one that way.
 */

import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { socketTimeoutMs, stopListening } from "./listener.js";
import { loadStartup } from "./startup.js";
import { RelayState, stateOptionsFrom, systemClock } from "./state.js";

const SWEEP_INTERVAL_MS = 60_000;

const { config, warnings } = loadStartup(process.env, (path) => readFileSync(path, "utf8"));
for (const warning of warnings) console.warn(warning);

const state = new RelayState(systemClock, stateOptionsFrom(config));

const port = Number(process.env["PORT"] ?? 8787);
const hostname = process.env["HOST"];

const buildId = process.env["RELAY_BUILD_ID"];

const server = serve({
  fetch: createApp({ config, state, ...(buildId === undefined ? {} : { buildId }) }).fetch,
  port,
  ...(hostname === undefined ? {} : { hostname }),
});
// A silent socket is closed once it has outlasted every upstream deadline.
server.setTimeout(socketTimeoutMs(config.limits));

const sweeper = setInterval(() => state.sweep(), SWEEP_INTERVAL_MS);
sweeper.unref();

const shutdown = (): void => {
  clearInterval(sweeper);
  stopListening(server, () => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(
  `relay listening on ${hostname ?? "*"}:${String(port)} with ${String(config.endpoints.length)} endpoint(s)`,
);
