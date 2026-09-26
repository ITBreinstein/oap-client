/**
 * The relay's one outbound request: an asynchronous execute, sent on the
 * browser's behalf so that `Location` can be read (finding 0039).
 *
 * Everything about the request is fixed here or comes from the config. The
 * browser contributes a process id, already checked against a narrow pattern,
 * and a JSON body. Nothing else it sends — no header, no cookie, no URL —
 * reaches the OGC server.
 *
 * - **Method:** `POST`, always.
 * - **URL:** `{endpoint.baseUrl}/processes/{processId}/execution`. The base
 *   comes from the allowlist, the id is percent-encoded.
 * - **Headers:** the four below and `Content-Length`. The same `Accept` and
 *   `Prefer` the core sends for an asynchronous execute, so the server sees the
 *   request it would have seen from the browser.
 * - **Address:** checked at connect time by `guardedLookup`, unless the
 *   endpoint is configured for a private network.
 * - **Redirects:** none followed. A 3xx fails the exchange. Validating every
 *   hop of a redirect chain is a policy with many edges; following zero hops
 *   has none, and no reference server redirects an execute.
 * - **Size and time:** the response body is capped and the whole exchange,
 *   connect to last byte, has one deadline.
 */

import { Buffer } from "node:buffer";
import http from "node:http";
import https from "node:https";
import type { EndpointConfig } from "./config.js";
import type { LookupOptions } from "node:dns";
import {
  guardedLookup,
  isBlockedHost,
  type LookupCallback,
  type Resolver,
} from "./address-guard.js";

export interface UpstreamResponse {
  readonly status: number;
  readonly location: string | undefined;
  readonly contentType: string | undefined;
  readonly preferenceApplied: string | undefined;
  readonly body: string;
}

/**
 * Why the exchange produced no usable response. Codes, not messages: they go
 * back to the browser, and a message could carry an address or a hostname the
 * browser has no business learning.
 */
export type UpstreamFailure =
  | "blocked-address"
  | "timeout"
  | "redirect-refused"
  /** Read route: more redirects under `baseUrl` than it follows. */
  | "redirect-limit"
  | "response-too-large"
  | "connection-failed";

export class UpstreamError extends Error {
  readonly reason: UpstreamFailure;

  constructor(reason: UpstreamFailure, options?: ErrorOptions) {
    super(`upstream exchange failed: ${reason}`, options);
    this.name = "UpstreamError";
    this.reason = reason;
  }
}

/** Run `callback` after `ms`; the returned function cancels it. */
export type Schedule = (callback: () => void, ms: number) => () => void;

export const systemSchedule: Schedule = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => {
    clearTimeout(handle);
  };
};

export interface UpstreamOptions {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  /** Injected in tests; `dns.lookup` otherwise. */
  readonly resolve?: Resolver | undefined;
  readonly schedule?: Schedule | undefined;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export function executionUrl(endpoint: EndpointConfig, processId: string): URL {
  return new URL(`${endpoint.baseUrl}/processes/${encodeURIComponent(processId)}/execution`);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function postExecute(
  endpoint: EndpointConfig,
  processId: string,
  body: string,
  options: UpstreamOptions,
): Promise<UpstreamResponse> {
  const url = executionUrl(endpoint, processId);
  const schedule = options.schedule ?? systemSchedule;
  const payload = Buffer.from(body, "utf8");

  if (!endpoint.allowPrivateNetwork && isBlockedHost(url.hostname)) {
    return Promise.reject(new UpstreamError("blocked-address"));
  }

  const transport = url.protocol === "https:" ? https : http;
  const resolve = options.resolve;

  return new Promise<UpstreamResponse>((resolvePromise, rejectPromise) => {
    let settled = false;
    let cancelDeadline = (): void => undefined;
    const finish = (outcome: UpstreamResponse | UpstreamError): void => {
      if (settled) return;
      settled = true;
      cancelDeadline();
      if (outcome instanceof UpstreamError) rejectPromise(outcome);
      else resolvePromise(outcome);
    };

    const request = transport.request(url, {
      method: "POST",
      // A fresh connection per request, so every request goes through the
      // lookup below. A pooled socket would skip it.
      agent: false,
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        Prefer: "respond-async",
        "User-Agent": "oap-client-relay",
        "Content-Length": String(payload.byteLength),
      },
      ...(endpoint.allowPrivateNetwork
        ? {}
        : {
            lookup: (hostname: string, lookupOptions: LookupOptions, callback: LookupCallback) => {
              guardedLookup(hostname, lookupOptions, callback, resolve);
            },
          }),
    });

    cancelDeadline = schedule(() => {
      finish(new UpstreamError("timeout"));
      request.destroy();
    }, options.timeoutMs);

    request.on("error", (cause: NodeJS.ErrnoException) => {
      const blockedLookup = cause.code === "ENOTFOUND" && cause.message.startsWith("refused:");
      finish(new UpstreamError(blockedLookup ? "blocked-address" : "connection-failed", { cause }));
    });

    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        response.destroy();
        finish(new UpstreamError("redirect-refused"));
        return;
      }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > options.maxResponseBytes) {
        response.destroy();
        finish(new UpstreamError("response-too-large"));
        return;
      }

      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > options.maxResponseBytes) {
          response.destroy();
          finish(new UpstreamError("response-too-large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", (cause) => {
        finish(new UpstreamError("connection-failed", { cause }));
      });
      response.on("end", () => {
        finish({
          status,
          location: firstHeader(response.headers.location),
          contentType: firstHeader(response.headers["content-type"]),
          preferenceApplied: firstHeader(response.headers["preference-applied"]),
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    request.end(payload);
  });
}
