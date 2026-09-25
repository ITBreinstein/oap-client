/**
 * The relay's wire contract, as the browser reads it.
 *
 * It lives here, in the web app, and not in `packages/core`: the core is a
 * runtime-neutral OGC API client that knows nothing about this relay, and a
 * consumer of the published package should not inherit it. The relay is one
 * application's answer to one browser limitation.
 *
 * Every response is checked member by member. Nothing is asserted into shape:
 * the relay is ours, but it is still a network peer, and a type guard that
 * says no is cheaper than a job panel that renders `undefined`.
 */

export type ExecuteRoute = "direct" | "relay";

/**
 * Whether the relay *may* carry this endpoint's reads. A permission, not a
 * route: the page still goes direct first, and uses it only after a CORS
 * failure and the user's confirmation.
 */
export type ReadRoute = "direct" | "relay";

export interface RelayEndpoint {
  readonly key: string;
  readonly baseUrl: string;
  readonly executeRoute: ExecuteRoute;
  readonly readRoute: ReadRoute;
  readonly callbacks: boolean;
  /** The process ids to list for this endpoint, when its configuration names some. */
  readonly processes?: readonly string[] | undefined;
}

/** On every response the relay sends. Missing: the relay did not send it. */
export const RELAY_MARKER = "X-Relay";
/** On every response the relay generated itself: its refusals and its own 502s. */
export const RELAY_ERROR = "X-Relay-Error";

export interface SessionGrant {
  readonly token: string;
  readonly expiresAt: number;
}

/** What the OGC server answered, as the relay read it. */
export interface UpstreamAnswer {
  readonly status: number;
  readonly location: string | undefined;
  readonly contentType: string | undefined;
  readonly preferenceApplied: string | undefined;
  readonly body: string;
}

export interface RelayedExecute {
  readonly upstream: UpstreamAnswer;
  /** Present when the relay registered callbacks for this job. */
  readonly ref: string | undefined;
}

export class RelayContractError extends Error {
  constructor(what: string) {
    super(`relay sent a malformed ${what}`);
    this.name = "RelayContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  what: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new RelayContractError(what);
  return value;
}

export function parseEndpoints(value: unknown): RelayEndpoint[] {
  if (!isRecord(value) || !Array.isArray(value["endpoints"])) {
    throw new RelayContractError("endpoint list");
  }
  return value["endpoints"].map((entry: unknown) => {
    if (!isRecord(entry)) throw new RelayContractError("endpoint");
    const { key, baseUrl, executeRoute, callbacks } = entry;
    // Absent from a relay older than the read route, which never offers it.
    const readRoute = entry["readRoute"] ?? "direct";
    if (
      (readRoute !== "direct" && readRoute !== "relay") ||
      typeof key !== "string" ||
      typeof baseUrl !== "string" ||
      (executeRoute !== "direct" && executeRoute !== "relay") ||
      typeof callbacks !== "boolean"
    ) {
      throw new RelayContractError("endpoint");
    }
    const processes = entry["processes"];
    if (
      processes !== undefined &&
      (!Array.isArray(processes) || !processes.every((id) => typeof id === "string"))
    ) {
      throw new RelayContractError("endpoint");
    }
    return {
      key,
      baseUrl,
      executeRoute,
      readRoute,
      callbacks,
      ...(processes === undefined
        ? {}
        : { processes: processes.filter((id) => typeof id === "string") }),
    };
  });
}

export function parseSessionGrant(value: unknown): SessionGrant {
  if (!isRecord(value)) throw new RelayContractError("session grant");
  const { token, expiresAt } = value;
  if (typeof token !== "string" || typeof expiresAt !== "number") {
    throw new RelayContractError("session grant");
  }
  return { token, expiresAt };
}

export function parseRelayedExecute(value: unknown): RelayedExecute {
  if (!isRecord(value) || !isRecord(value["upstream"])) {
    throw new RelayContractError("execute answer");
  }
  const upstream = value["upstream"];
  const status = upstream["status"];
  const body = upstream["body"];
  if (typeof status !== "number" || !Number.isInteger(status) || typeof body !== "string") {
    throw new RelayContractError("execute answer");
  }
  const registration = value["registration"];
  let ref: string | undefined;
  if (registration !== null) {
    if (!isRecord(registration) || typeof registration["ref"] !== "string") {
      throw new RelayContractError("registration");
    }
    ref = registration["ref"];
  }
  return {
    upstream: {
      status,
      body,
      location: optionalString(upstream, "location", "execute answer"),
      contentType: optionalString(upstream, "contentType", "execute answer"),
      preferenceApplied: optionalString(upstream, "preferenceApplied", "execute answer"),
    },
    ref,
  };
}

/**
 * The `ref` out of a `job` event's data, or `undefined` for anything else.
 * Never throws: a doorbell that cannot be read is a doorbell not rung, and the
 * baseline poll covers it.
 */
export function parseDoorbell(data: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const ref = value["ref"];
  return typeof ref === "string" && ref !== "" ? ref : undefined;
}

/** The relay's refusal reason, when it sent one it names. */
export function readRefusalReason(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const reason = value["reason"] ?? value["detail"];
  return typeof reason === "string" ? reason : undefined;
}
