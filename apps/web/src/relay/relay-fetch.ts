/**
 * The relay's read route, as a `fetch` the core can be handed.
 *
 * Used only for an endpoint configured with `readRoute: "relay"`, only after
 * the page tried the server directly and failed the way a missing CORS header
 * fails, and only after the user confirmed. None of that is decided here; see
 * `app/route-decision.ts`. This only carries requests once that is settled.
 *
 * The core does not know the relay exists. It builds its URLs against the
 * server's own `baseUrl`, sends them through whatever `fetch` it was given,
 * and reads the evidence off the response. This wrapper rewrites each URL
 * under `baseUrl` onto `/read/{endpointKey}/…` and hands back the server's
 * answer as though the server had sent it with perfect CORS headers. So
 * discovery, the process list, descriptions, job status, results and dismissal
 * all work unchanged.
 *
 * ## Whose answer is this?
 *
 * The relay marks what it sends, and this wrapper reads the marks in order:
 *
 * 1. No `X-Relay`: the relay did not send this. A reverse proxy in front of it
 *    answers 502 or 504 by itself when the relay is down.
 * 2. `X-Relay-Error`: the relay is speaking — a refusal, or its own 502 for an
 *    exchange that produced no response.
 * 3. Otherwise: the OGC server's own answer, its 404 and 500 included.
 *
 * Only (3) reaches the core as a `Response`. (1) and (2) are thrown as a
 * {@link RelayRouteError}. The core's transport wraps a throw into a
 * `TransportError`, so the relay's failure can never be read as the server's.
 */

import type { FetchLike } from "@breinstein/oap-client";
import { RELAY_ERROR, RELAY_MARKER } from "./contract.js";
import type { RelayClient } from "./relay-client.js";
import type { SessionSource } from "./routed-fetch.js";

/**
 * How an attempt through the relay ended, for the `endpoint-access` record.
 * `other-failure` is the one outcome this module never produces: a response
 * the server really sent, which the core then could not use. It still proves
 * the server was up.
 */
export type RelayOutcome =
  "ok" | "relay-unreachable" | "relay-refused" | "upstream-failed" | "other-failure";

/** The relay route failed on the relay's side, not the OGC server's. */
export class RelayRouteError extends Error {
  readonly outcome: "relay-unreachable" | "relay-refused" | "upstream-failed";
  /** The relay's `X-Relay-Error` code verbatim, or one of ours: `no-relay-marker`, `unreachable`, … */
  readonly code: string;
  readonly status: number | undefined;

  constructor(outcome: RelayRouteError["outcome"], code: string, status?: number) {
    super(`relay route: ${outcome} (${code})`);
    this.name = "RelayRouteError";
    this.outcome = outcome;
    this.code = code;
    this.status = status;
  }
}

/** The {@link RelayRouteError} behind an error, however deep the core wrapped it. */
export function relayRouteErrorIn(error: unknown): RelayRouteError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof RelayRouteError) return current;
    current = current.cause;
  }
  return undefined;
}

/** Statuses that may not carry a body, which `new Response` refuses one for. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/**
 * The server's answer, or a throw for anything else. Rebuilt rather than passed
 * through: a hand-built `Response` has an empty `url`, so the core takes the
 * URL it asked for — the server's, not the relay's — for resolving relative
 * links.
 */
export function fromRelay(response: Response): Response {
  if (!response.headers.has(RELAY_MARKER)) {
    throw new RelayRouteError("relay-unreachable", "no-relay-marker", response.status);
  }
  const code = response.headers.get(RELAY_ERROR);
  if (code !== null) {
    throw new RelayRouteError(
      response.status === 502 ? "upstream-failed" : "relay-refused",
      code,
      response.status,
    );
  }
  return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * True when `url` is `baseUrl` or below it: same origin, and a path that is the
 * base path or continues it at a segment boundary. Both sides are parsed, so
 * this compares normalised URLs, not strings.
 */
export function isUnder(url: URL, baseUrl: string): boolean {
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) return false;
  const basePath = base.pathname.replace(/\/+$/, "");
  return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

/** Path and query of `url` after the base path: `""` for the base itself, else starting with `/`. */
export function relativeTo(url: URL, baseUrl: string): string {
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  return `${url.pathname.slice(basePath.length)}${url.search}`;
}

export interface RelayFetchOptions {
  readonly relay: RelayClient;
  readonly endpointKey: string;
  readonly baseUrl: string;
  readonly session: SessionSource;
}

/** Methods the read route carries. An execute goes through `routed-fetch.ts`, never here. */
const CARRIED: ReadonlySet<string> = new Set(["GET", "HEAD", "DELETE"]);

/** The core's request, as the read route will carry it. */
async function readRequest(
  options: RelayFetchOptions,
  input: string,
  init: RequestInit | undefined,
): Promise<{ readonly path: string; readonly init: RequestInit; readonly token: string }> {
  const target = new URL(input);
  // The core must never reach, through the relay, a server the relay is not
  // configured for: a result link to another host stays a direct request.
  if (!isUnder(target, options.baseUrl)) {
    throw new RelayRouteError("relay-refused", "outside-base");
  }
  const method = (init?.method ?? "GET").toUpperCase();
  if (!CARRIED.has(method)) throw new RelayRouteError("relay-refused", "method-not-carried");

  const token = options.session.current() ?? (await options.session.renew());
  if (token === undefined) throw new RelayRouteError("relay-unreachable", "no-session");

  const headers = new Headers(init?.headers);
  headers.delete("Authorization");
  return {
    path: `/read/${encodeURIComponent(options.endpointKey)}${relativeTo(target, options.baseUrl)}`,
    init: {
      method,
      headers,
      ...(init?.signal === undefined || init.signal === null ? {} : { signal: init.signal }),
    },
    token,
  };
}

export function createRelayFetch(options: RelayFetchOptions): FetchLike {
  const send = async (path: string, init: RequestInit, token: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    try {
      return await options.relay.forward(path, { ...init, headers });
    } catch (cause) {
      // The caller's abort is theirs, not the relay's: let it through as is.
      if (init.signal?.aborted === true) throw cause;
      throw new RelayRouteError("relay-unreachable", "unreachable");
    }
  };

  return async (input, init) => {
    const request = await readRequest(options, input, init);
    let response = await send(request.path, request.init, request.token);
    // A relay restart forgets sessions. It refused before forwarding anything,
    // so asking again on a new session cannot repeat a request upstream.
    if (
      response.headers.has(RELAY_MARKER) &&
      response.headers.get(RELAY_ERROR) === "unknown-session"
    ) {
      const renewed = await options.session.renew();
      if (renewed !== undefined) response = await send(request.path, request.init, renewed);
    }
    return fromRelay(response);
  };
}
