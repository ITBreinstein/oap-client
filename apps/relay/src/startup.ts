/**
 * What the relay process starts with: the config named by `RELAY_CONFIG`,
 * parsed under the private-address allowance `RELAY_ALLOW_PRIVATE_ADDRESSES`,
 * and the warnings the operator must see before anything is served.
 *
 * Kept apart from `server.ts`, which only listens, so that "this environment
 * refuses to start" can be tested without starting a process.
 */

import { ConfigError, parseConfig, PRIVATE_ADDRESS_ALLOWANCE, type RelayConfig } from "./config.js";

export interface Startup {
  readonly config: RelayConfig;
  /** Printed to stderr at startup, before listening. */
  readonly warnings: readonly string[];
}

/** Unset, empty or `0` is off; `1` is on; anything else is a typo, and refused. */
function readAllowance(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new ConfigError(PRIVATE_ADDRESS_ALLOWANCE, 'must be "1", "0" or unset');
}

function allowanceWarning(config: RelayConfig): string {
  const keys = config.endpoints
    .filter((endpoint) => endpoint.allowPrivateNetwork)
    .map((endpoint) => endpoint.key);
  if (keys.length === 0) {
    return `relay: WARNING ${PRIVATE_ADDRESS_ALLOWANCE}=1 is set, but no endpoint sets allowPrivateNetwork, so it does nothing. Unset it.`;
  }
  return `relay: WARNING ${PRIVATE_ADDRESS_ALLOWANCE}=1 — the address guard is OFF for ${keys.join(", ")}: they may reach loopback, private and cloud-metadata addresses. Local development and CI only; never a public deployment.`;
}

export function loadStartup(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string,
): Startup {
  const allowPrivateAddresses = readAllowance(env[PRIVATE_ADDRESS_ALLOWANCE]);
  const configPath = env["RELAY_CONFIG"];
  const raw: unknown =
    configPath === undefined ? { endpoints: [] } : JSON.parse(readFile(configPath));
  const config = parseConfig(raw, { allowPrivateAddresses });
  return { config, warnings: allowPrivateAddresses ? [allowanceWarning(config)] : [] };
}
