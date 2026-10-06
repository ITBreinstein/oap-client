/**
 * The relay's asynchronous execute, sent on the browser's behalf so that
 * `Location` can be read (finding 0039).
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
 * - **The answer:** a `201` or `202` names a job. Its body — a status
 *   document, or nothing — is read whole, under a small cap, and handed back as
 *   an {@link UpstreamResponse} for the relay's envelope. Any other answer is
 *   not a job: the result itself, from a server that ran the process
 *   synchronously anyway (finding 0059), or a refusal. It is handed back as a
 *   {@link RawAnswer}, its body streamed the way the read route streams one,
 *   under the read route's larger cap, for the relay to pass on unchanged.
 *   Read as text, a binary result was corrupted, and under the small cap a
 *   result the server had already produced was refused (review R7).
 * - **Size and time:** each kind of body has its cap, and the whole exchange,
 *   connect to last byte, has one deadline — a raw body still streaming
 *   included.
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
import { systemSchedule, UpstreamError, type Schedule } from "./exchange.js";
import {
  NULL_BODY_STATUSES,
  returnedHeaders,
  streamBody,
  type ForwardedResponse,
} from "./forward.js";

/** A job: a `201` or `202`, read whole, for the relay's envelope. */
export interface UpstreamResponse {
  readonly status: number;
  readonly location: string | undefined;
  readonly contentType: string | undefined;
  readonly preferenceApplied: string | undefined;
  readonly body: string;
}

/** Any other answer, its body still streaming, to be passed on unchanged. */
export interface RawAnswer {
  readonly raw: ForwardedResponse;
}

export type ExecuteAnswer = UpstreamResponse | RawAnswer;

export interface UpstreamOptions {
  readonly timeoutMs: number;
  /** Cap on a job's body, which is read whole. */
  readonly maxResponseBytes: number;
  /** Cap on a {@link RawAnswer}'s body, which is streamed. `maxResponseBytes` unless given. */
  readonly maxRawResponseBytes?: number | undefined;
  /** Injected in tests; `dns.lookup` otherwise. */
  readonly resolve?: Resolver | undefined;
  readonly schedule?: Schedule | undefined;
}

/** The answers that name a job: `201 Created`, which the standard asks for, or `202 Accepted`. */
const JOB_STATUSES: ReadonlySet<number> = new Set([201, 202]);

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
): Promise<ExecuteAnswer> {
  const url = executionUrl(endpoint, processId);
  const schedule = options.schedule ?? systemSchedule;
  const payload = Buffer.from(body, "utf8");

  if (!endpoint.allowPrivateNetwork && isBlockedHost(url.hostname)) {
    return Promise.reject(new UpstreamError("blocked-address"));
  }

  const transport = url.protocol === "https:" ? https : http;
  const resolve = options.resolve;

  return new Promise<ExecuteAnswer>((resolvePromise, rejectPromise) => {
    let settled = false;
    let cancelDeadline = (): void => undefined;
    const finish = (outcome: ExecuteAnswer | UpstreamError): void => {
      if (settled) return;
      settled = true;
      // A raw answer's body is still streaming, and the deadline still ends it.
      if (!("raw" in outcome)) cancelDeadline();
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

    let onDeadline = (): void => {
      finish(new UpstreamError("timeout"));
      request.destroy();
    };
    cancelDeadline = schedule(() => {
      onDeadline();
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
      const job = JOB_STATUSES.has(status);
      const cap = job
        ? options.maxResponseBytes
        : (options.maxRawResponseBytes ?? options.maxResponseBytes);
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > cap) {
        response.destroy();
        finish(new UpstreamError("response-too-large"));
        return;
      }

      if (!job) {
        const streamed = streamBody(response, cap);
        onDeadline = () => {
          streamed.breakOff("duration");
        };
        void streamed.done.then(() => {
          cancelDeadline();
        });
        finish({
          raw: {
            status,
            headers: returnedHeaders(response),
            body: NULL_BODY_STATUSES.has(status) ? null : streamed.body,
            finalUrl: url.toString(),
            redirectsFollowed: 0,
            done: streamed.done,
          },
        });
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
