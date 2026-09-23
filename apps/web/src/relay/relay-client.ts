/**
 * Talking to the relay: four calls, each a thin wrapper that checks what came
 * back. `credentials: "omit"` on every one — the relay authenticates with
 * tokens it issued, never with cookies, and sending the page's cookies to it
 * would be sending them somewhere they have no business going.
 */

import type { FetchLike } from "@breinstein/oap-client";
import {
  parseEndpoints,
  parseRelayedExecute,
  parseSessionGrant,
  readRefusalReason,
  type RelayEndpoint,
  type RelayedExecute,
  type SessionGrant,
} from "./contract.js";

/**
 * The relay said no, or could not reach the OGC server. `code` is the relay's
 * own reason when it gave one, otherwise the HTTP status.
 *
 * `beforeUpstream` is the load-bearing field: true only when the relay refused
 * before sending anything to the OGC server, so no job can exist. That is the
 * only case in which trying again cannot create a second job.
 */
export class RelayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly beforeUpstream: boolean;

  constructor(status: number, code: string, beforeUpstream: boolean) {
    super(`relay refused (${String(status)}): ${code}`);
    this.name = "RelayError";
    this.status = status;
    this.code = code;
    this.beforeUpstream = beforeUpstream;
  }
}

export interface RelayClient {
  readonly baseUrl: string;
  endpoints(signal?: AbortSignal): Promise<RelayEndpoint[]>;
  createSession(signal?: AbortSignal): Promise<SessionGrant>;
  /** Open the doorbell stream. The caller reads the body. */
  openEvents(sessionToken: string, signal?: AbortSignal): Promise<Response>;
  execute(
    endpointKey: string,
    processId: string,
    body: string,
    sessionToken: string | undefined,
    signal?: AbortSignal,
  ): Promise<RelayedExecute>;
}

/**
 * The relay's refusals that are answered before it sends anything upstream —
 * see the route in `apps/relay/src/app.ts`. A 502 comes after an attempt, and a
 * 500 could come from anywhere, so neither is on the list.
 */
const REFUSED_BEFORE_UPSTREAM: ReadonlySet<number> = new Set([
  400, 401, 404, 409, 413, 415, 429, 503,
]);

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createRelayClient(baseUrl: string, fetchImpl: FetchLike = fetch): RelayClient {
  const base = baseUrl.replace(/\/+$/, "");
  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetchImpl(`${base}${path}`, { ...init, credentials: "omit", redirect: "error" });

  return {
    baseUrl: base,

    async endpoints(signal) {
      const response = await call("/endpoints", signal === undefined ? {} : { signal });
      if (!response.ok) throw new RelayError(response.status, "endpoints", true);
      return parseEndpoints(await readJson(response));
    },

    async createSession(signal) {
      const response = await call("/sessions", {
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status !== 201) throw new RelayError(response.status, "session", true);
      return parseSessionGrant(await readJson(response));
    },

    openEvents(sessionToken, signal) {
      return call("/sessions/events", {
        headers: { Authorization: `Bearer ${sessionToken}`, Accept: "text/event-stream" },
        cache: "no-store",
        ...(signal === undefined ? {} : { signal }),
      });
    },

    async execute(endpointKey, processId, body, sessionToken, signal) {
      const response = await call(
        `/execute/${encodeURIComponent(endpointKey)}/${encodeURIComponent(processId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(sessionToken === undefined ? {} : { Authorization: `Bearer ${sessionToken}` }),
          },
          body,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (response.status === 200) return parseRelayedExecute(await readJson(response));
      const code = readRefusalReason(await readJson(response)) ?? String(response.status);
      throw new RelayError(response.status, code, REFUSED_BEFORE_UPSTREAM.has(response.status));
    },
  };
}
