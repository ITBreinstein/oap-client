/**
 * Relay configuration: which OGC endpoints exist, how each one is reached, and
 * the limits the relay enforces.
 *
 * Read once at startup and validated completely, so a bad deployment fails to
 * start rather than failing on the first request. Every value is checked with a
 * type guard. Nothing is asserted into shape, because the file is operator
 * input and a typo in it must not turn into an open proxy.
 *
 * ## The two per-endpoint decisions
 *
 * `executeRoute` is chosen **before** anything is sent, per endpoint, and never
 * by trying one route and falling back to the other. Execute is not
 * idempotent: a direct attempt that reached the server but whose response the
 * browser could not read has already created a job, and a relay retry would
 * create a second one and orphan the first.
 *
 * `readRoute` is opt-in too, and off unless the file says otherwise. With
 * `"relay"` the relay forwards the browser's reads of that one endpoint —
 * `GET` under its `baseUrl`, `DELETE` on a job, and synchronous executes — for
 * a server that sends no CORS headers (finding 0050). The web app still tries
 * the server directly first, and only takes this route after the user
 * confirmed it. It requires `executeRoute: "relay"`: a browser that cannot
 * read the server cannot read an execute's answer either.
 *
 * `callbacks` is opt-in, and off unless the file says otherwise. Against
 * pygeoapi 0.21.0 a callback that cannot be delivered stalls the job or turns a
 * successful one into `failed` (finding 0047), so sending subscriber URLs makes
 * the relay's *availability* part of the job's correctness. Polling works
 * without it.
 *
 * ## Private addresses take two keys
 *
 * An endpoint on `http:`, or on a loopback, private or otherwise reserved
 * host, is refused at startup unless **both** keys are turned: the endpoint
 * sets `allowPrivateNetwork`, which switches the address guard off for it, and
 * the deployment sets `RELAY_ALLOW_PRIVATE_ADDRESSES=1` (passed in here as
 * `allowPrivateAddresses`). Neither enables anything alone, so a local or CI
 * config copied into a public deployment fails to start instead of running
 * with the guard off. Only a host literal can be judged here; a name is
 * checked at connect time, on every address it resolves to.
 */

import { isBlockedHost } from "./address-guard.js";

/** The deployment's key: without it set to `1`, no endpoint may set `allowPrivateNetwork`. */
export const PRIVATE_ADDRESS_ALLOWANCE = "RELAY_ALLOW_PRIVATE_ADDRESSES";

export interface ParseOptions {
  /** `RELAY_ALLOW_PRIVATE_ADDRESSES=1`. Off unless given. */
  readonly allowPrivateAddresses?: boolean | undefined;
}

/** How the browser's execute request reaches this endpoint. */
export type ExecuteRoute = "direct" | "relay";

/** Whether the relay may forward the browser's reads of this endpoint. */
export type ReadRoute = "direct" | "relay";

export interface EndpointConfig {
  /** Stable identifier the browser names the endpoint by. Never a URL. */
  readonly key: string;
  /** The OGC API landing page, without a trailing slash. */
  readonly baseUrl: string;
  readonly executeRoute: ExecuteRoute;
  readonly readRoute: ReadRoute;
  /** Whether the relay registers callbacks for jobs it starts here. */
  readonly callbacks: boolean;
  /**
   * Allow this endpoint to resolve to a loopback, private or otherwise
   * reserved address, and to use plain `http:`. For local development and CI,
   * where the reference servers are on `localhost`, and accepted only with
   * `RELAY_ALLOW_PRIVATE_ADDRESSES=1`. A public deployment leaves it false, and
   * then every address the name resolves to is checked, at connect time.
   */
  readonly allowPrivateNetwork: boolean;
}

export interface RelayLimits {
  /** Largest execute body accepted from the browser. */
  readonly maxExecuteBodyBytes: number;
  /** Largest upstream response body relayed back. */
  readonly maxUpstreamResponseBytes: number;
  /** Deadline for the whole upstream exchange, connect to last byte. */
  readonly upstreamTimeoutMs: number;
  readonly maxSessions: number;
  readonly maxRegistrationsPerSession: number;
  /**
   * Event streams one session may hold. One more closes its oldest: a page
   * holds one, so more is a reconnect racing its predecessor, or a client
   * hoarding sockets.
   */
  readonly maxStreamsPerSession: number;
  /** Event streams open across all sessions. One more is refused with a 503. */
  readonly maxOpenStreams: number;
  /**
   * Largest body the read route passes back — reads and synchronous executes.
   * Streamed, not buffered, so this bounds traffic rather than memory.
   */
  readonly maxReadResponseBytes: number;
  /** Deadline for one read-route exchange, connect to last byte. */
  readonly readTimeoutMs: number;
}

export interface RelayConfig {
  /**
   * The relay's own URL as the OGC servers see it, which the callback URLs are
   * built from. Required when any endpoint has `callbacks` on. Often not the
   * URL the browser uses: in CI the servers reach the host as
   * `host.docker.internal`.
   */
  readonly publicUrl: string | undefined;
  /** Exact origins allowed to call the relay from a browser. */
  readonly allowedOrigins: readonly string[];
  readonly endpoints: readonly EndpointConfig[];
  readonly registrationTtlMs: number;
  readonly sessionIdleTtlMs: number;
  /** A session ends this long after it was made, however busy, open streams included. */
  readonly sessionMaxAgeMs: number;
  readonly limits: RelayLimits;
}

export const DEFAULT_LIMITS: RelayLimits = {
  maxExecuteBodyBytes: 1024 * 1024,
  maxUpstreamResponseBytes: 256 * 1024,
  upstreamTimeoutMs: 30_000,
  maxSessions: 10_000,
  maxRegistrationsPerSession: 100,
  maxStreamsPerSession: 4,
  maxOpenStreams: 1_000,
  maxReadResponseBytes: 50 * 1024 * 1024,
  readTimeoutMs: 120_000,
};

export const DEFAULT_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SESSION_IDLE_TTL_MS = 60 * 60 * 1000;
/** As long as a callback registration lives: no session outlasts the jobs it can be told about. */
export const DEFAULT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class ConfigError extends Error {
  constructor(path: string, problem: string) {
    super(`relay config: ${path} ${problem}`);
    this.name = "ConfigError";
  }
}

const ENDPOINT_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") {
    throw new ConfigError(`${path}.${key}`, "must be a non-empty string");
  }
  return value;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ConfigError(`${path}.${key}`, "must be a boolean");
  return value;
}

/**
 * The longest delay Node's timers hold: a signed 32-bit millisecond count, a
 * little under 25 days. A longer one fires after 1 ms instead (review R10).
 */
export const MAX_TIMER_MS = 2_147_483_647;

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
): number {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ConfigError(`${path}.${key}`, "must be a positive integer");
  }
  return value;
}

/** A deadline the relay arms as a timer, so no longer than {@link MAX_TIMER_MS}. */
function readTimeoutMs(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
): number {
  const value = readPositiveInteger(record, key, path, fallback);
  if (value > MAX_TIMER_MS) {
    throw new ConfigError(`${path}.${key}`, `must be at most ${String(MAX_TIMER_MS)} ms`);
  }
  return value;
}

/**
 * An http(s) URL with no credentials, query or fragment, returned without a
 * trailing slash. Credentials in a configured URL would be sent to the server
 * on every request and printed wherever the URL is; a query or fragment has no
 * meaning on a base the relay appends paths to.
 */
export function normaliseHttpUrl(value: string, path: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(path, "is not a URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(path, "must be http or https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ConfigError(path, "must not carry credentials");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new ConfigError(path, "must not carry a query or fragment");
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

function parseEndpoint(value: unknown, path: string, options: ParseOptions): EndpointConfig {
  if (!isRecord(value)) throw new ConfigError(path, "must be an object");
  const key = readString(value, "key", path);
  if (!ENDPOINT_KEY.test(key)) {
    throw new ConfigError(`${path}.key`, "must be lowercase letters, digits and dashes");
  }
  const route = value["executeRoute"] ?? "direct";
  if (route !== "direct" && route !== "relay") {
    throw new ConfigError(`${path}.executeRoute`, 'must be "direct" or "relay"');
  }
  const readRoute = value["readRoute"] ?? "direct";
  if (readRoute !== "direct" && readRoute !== "relay") {
    throw new ConfigError(`${path}.readRoute`, 'must be "direct" or "relay"');
  }
  if (readRoute === "relay" && route !== "relay") {
    throw new ConfigError(`${path}.readRoute`, 'may be "relay" only with executeRoute "relay"');
  }
  const baseUrl = normaliseHttpUrl(readString(value, "baseUrl", path), `${path}.baseUrl`);
  const allowPrivateNetwork = readBoolean(value, "allowPrivateNetwork", path, false);
  if (allowPrivateNetwork && options.allowPrivateAddresses !== true) {
    throw new ConfigError(
      `${path}.allowPrivateNetwork`,
      `is accepted only with ${PRIVATE_ADDRESS_ALLOWANCE}=1 in the environment`,
    );
  }
  if (!allowPrivateNetwork) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:") {
      throw new ConfigError(`${path}.baseUrl`, "must be https unless allowPrivateNetwork is set");
    }
    if (isBlockedHost(parsed.hostname)) {
      throw new ConfigError(
        `${path}.baseUrl`,
        "is a loopback, private or reserved host, which needs allowPrivateNetwork",
      );
    }
  }
  return {
    key,
    baseUrl,
    executeRoute: route,
    readRoute,
    callbacks: readBoolean(value, "callbacks", path, false),
    allowPrivateNetwork,
  };
}

function parseOrigin(value: unknown, path: string): string {
  if (typeof value !== "string") throw new ConfigError(path, "must be a string");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(path, "is not an origin");
  }
  // Compared verbatim against the Origin header, so it must already be one.
  if (parsed.origin !== value) throw new ConfigError(path, `must be exactly an origin`);
  return value;
}

export function parseConfig(input: unknown, options: ParseOptions = {}): RelayConfig {
  if (!isRecord(input)) throw new ConfigError("(root)", "must be an object");

  const rawEndpoints = input["endpoints"];
  if (!Array.isArray(rawEndpoints)) throw new ConfigError("endpoints", "must be an array");
  const endpoints = rawEndpoints.map((entry, index) =>
    parseEndpoint(entry, `endpoints[${String(index)}]`, options),
  );
  const keys = new Set<string>();
  for (const endpoint of endpoints) {
    if (keys.has(endpoint.key)) throw new ConfigError("endpoints", `repeat key ${endpoint.key}`);
    keys.add(endpoint.key);
  }

  const rawOrigins = input["allowedOrigins"] ?? [];
  if (!Array.isArray(rawOrigins)) throw new ConfigError("allowedOrigins", "must be an array");
  const allowedOrigins = rawOrigins.map((entry, index) =>
    parseOrigin(entry, `allowedOrigins[${String(index)}]`),
  );

  const rawPublicUrl = input["publicUrl"];
  let publicUrl: string | undefined;
  if (rawPublicUrl !== undefined) {
    if (typeof rawPublicUrl !== "string") throw new ConfigError("publicUrl", "must be a string");
    publicUrl = normaliseHttpUrl(rawPublicUrl, "publicUrl");
  }
  if (publicUrl === undefined && endpoints.some((endpoint) => endpoint.callbacks)) {
    throw new ConfigError("publicUrl", "is required when any endpoint has callbacks on");
  }

  const rawLimits = input["limits"] ?? {};
  if (!isRecord(rawLimits)) throw new ConfigError("limits", "must be an object");
  const limits: RelayLimits = {
    maxExecuteBodyBytes: readPositiveInteger(
      rawLimits,
      "maxExecuteBodyBytes",
      "limits",
      DEFAULT_LIMITS.maxExecuteBodyBytes,
    ),
    maxUpstreamResponseBytes: readPositiveInteger(
      rawLimits,
      "maxUpstreamResponseBytes",
      "limits",
      DEFAULT_LIMITS.maxUpstreamResponseBytes,
    ),
    upstreamTimeoutMs: readTimeoutMs(
      rawLimits,
      "upstreamTimeoutMs",
      "limits",
      DEFAULT_LIMITS.upstreamTimeoutMs,
    ),
    maxSessions: readPositiveInteger(
      rawLimits,
      "maxSessions",
      "limits",
      DEFAULT_LIMITS.maxSessions,
    ),
    maxRegistrationsPerSession: readPositiveInteger(
      rawLimits,
      "maxRegistrationsPerSession",
      "limits",
      DEFAULT_LIMITS.maxRegistrationsPerSession,
    ),
    maxStreamsPerSession: readPositiveInteger(
      rawLimits,
      "maxStreamsPerSession",
      "limits",
      DEFAULT_LIMITS.maxStreamsPerSession,
    ),
    maxOpenStreams: readPositiveInteger(
      rawLimits,
      "maxOpenStreams",
      "limits",
      DEFAULT_LIMITS.maxOpenStreams,
    ),
    maxReadResponseBytes: readPositiveInteger(
      rawLimits,
      "maxReadResponseBytes",
      "limits",
      DEFAULT_LIMITS.maxReadResponseBytes,
    ),
    readTimeoutMs: readTimeoutMs(
      rawLimits,
      "readTimeoutMs",
      "limits",
      DEFAULT_LIMITS.readTimeoutMs,
    ),
  };

  return {
    publicUrl,
    allowedOrigins,
    endpoints,
    registrationTtlMs: readPositiveInteger(
      input,
      "registrationTtlMs",
      "(root)",
      DEFAULT_REGISTRATION_TTL_MS,
    ),
    sessionIdleTtlMs: readPositiveInteger(
      input,
      "sessionIdleTtlMs",
      "(root)",
      DEFAULT_SESSION_IDLE_TTL_MS,
    ),
    sessionMaxAgeMs: readPositiveInteger(
      input,
      "sessionMaxAgeMs",
      "(root)",
      DEFAULT_SESSION_MAX_AGE_MS,
    ),
    limits,
  };
}
