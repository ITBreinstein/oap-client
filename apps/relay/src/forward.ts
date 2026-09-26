/**
 * The read route's outbound request: one browser read of one configured
 * endpoint, forwarded because that server sends no CORS headers (finding
 * 0050), and only after the user confirmed it in the web app.
 *
 * It is not a general proxy, and everything that keeps it from becoming one
 * is here or in {@link resolveReadTarget}:
 *
 * - **URL:** built from the endpoint's `baseUrl` and a path the browser sent
 *   *relative* to it. Never a URL from the browser. The result must still be
 *   under `baseUrl` after normalisation, or nothing is sent.
 * - **Method:** `GET`, `DELETE` on a job (checked by the route), and the
 *   synchronous execute `POST` (built by the route).
 * - **Headers out:** only {@link FORWARDED_REQUEST_HEADERS}, plus the relay's
 *   own `User-Agent`. No cookie, no authorization, no origin.
 * - **Headers back:** only {@link RETURNED_RESPONSE_HEADERS} — the evidence the
 *   core reads — and nothing inside a body is rewritten.
 * - **Redirects:** followed by hand, for `GET` only, and only to a target still
 *   under `baseUrl`, at most {@link MAX_REDIRECTS} times. Anything else is
 *   handed back as the server sent it.
 * - **Address:** every hop connects through `guardedLookup`, on a fresh
 *   socket, unless the endpoint is configured for a private network.
 * - **Size and time:** the body is streamed, never buffered, under a byte cap
 *   and one deadline for the whole exchange. A cap hit before the status line
 *   is an {@link UpstreamError}, which the route answers `502`. A cap hit while
 *   the body is streaming can no longer change the status, so the stream is
 *   broken off instead — the browser sees a failed read, never a short body
 *   presented as whole — and the audit line records which cap it was.
 */

import { Buffer } from "node:buffer";
import type { LookupOptions } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import {
  guardedLookup,
  isBlockedHost,
  type LookupCallback,
  type Resolver,
} from "./address-guard.js";
import type { EndpointConfig } from "./config.js";
import { systemSchedule, UpstreamError, type Schedule } from "./upstream.js";

/** Request headers the browser may send upstream. Everything else is dropped. */
export const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "prefer",
  "content-type",
] as const;

/** Response headers handed back: the evidence, and nothing else. */
export const RETURNED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-crs",
  "content-disposition",
  "location",
  "retry-after",
  "link",
  "preference-applied",
] as const;

export const MAX_REDIRECTS = 3;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Statuses that may not carry a body, which `new Response` refuses one for. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/** Why a relative path was not turned into an upstream URL. */
export type ReadTargetRefusal =
  "absolute-url" | "dot-segment" | "encoded-separator" | "outside-base";

/**
 * True when `url` is `baseUrl` or below it: same origin, and a path that is the
 * base path or continues it at a segment boundary. `/ogc-api-evil` is not under
 * `/ogc-api`. Both sides are parsed first, so this compares normalised URLs,
 * never raw strings.
 */
export function isUnderBase(url: URL, baseUrl: string): boolean {
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) return false;
  const basePath = base.pathname.replace(/\/+$/, "");
  return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

/**
 * Decode one path segment, or `undefined` when it is not valid
 * percent-encoding — which is refused rather than guessed at.
 */
function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * The upstream URL for a browser read, or why there is none.
 *
 * `relativePath` is what followed `/read/{endpointKey}` in the relay's own
 * path: empty for the base itself, otherwise starting with `/`. `search` is
 * the query string verbatim, `?` included, or empty.
 *
 * WHATWG URL parsing already removes `.` and `..` segments, `%2e` spellings
 * included, before a path reaches the relay. They are refused here anyway,
 * because the relay must not depend on how its caller parsed the URL, and so
 * are encoded slashes and backslashes, which some servers decode into
 * separators after our check has passed.
 */
export function resolveReadTarget(
  endpoint: EndpointConfig,
  relativePath: string,
  search: string,
): URL | ReadTargetRefusal {
  if (relativePath !== "" && !relativePath.startsWith("/")) return "absolute-url";
  if (relativePath.startsWith("//")) return "absolute-url";
  const segments = relativePath.split("/").slice(1);
  if (segments[0] !== undefined && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(segments[0])) {
    return "absolute-url";
  }
  for (const segment of segments) {
    if (/%2f|%5c|\\/i.test(segment)) return "encoded-separator";
    const decoded = decodeSegment(segment);
    if (decoded === undefined) return "encoded-separator";
    if (decoded === "." || decoded === "..") return "dot-segment";
  }
  let url: URL;
  try {
    url = new URL(`${endpoint.baseUrl}${relativePath}${search}`);
  } catch {
    return "outside-base";
  }
  return isUnderBase(url, endpoint.baseUrl) ? url : "outside-base";
}

/** True when `url` is one job: `{baseUrl}/jobs/{jobId}`, and nothing below it. */
export function isJobResource(endpoint: EndpointConfig, url: URL): boolean {
  const basePath = new URL(endpoint.baseUrl).pathname.replace(/\/+$/, "");
  const rest = url.pathname.slice(basePath.length);
  return /^\/jobs\/[^/]+$/.test(rest);
}

export interface ForwardRequest {
  readonly method: "GET" | "DELETE" | "POST";
  readonly url: URL;
  /** The browser's headers. Only {@link FORWARDED_REQUEST_HEADERS} are read. */
  readonly headers: Headers;
  readonly body?: string | undefined;
}

/** How the body stream ended, for the audit line. */
export interface ForwardDone {
  readonly bytes: number;
  readonly capHit: "bytes" | "duration" | undefined;
}

export interface ForwardedResponse {
  readonly status: number;
  /** Allowlisted only. */
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  /** The URL that answered, after any redirects the relay followed. */
  readonly finalUrl: string;
  readonly redirectsFollowed: number;
  /** Settles when the body has been passed on, broken off, or cancelled. */
  readonly done: Promise<ForwardDone>;
}

/** The `lookup` a connection uses. `guardedLookup` unless a test injects one. */
export type Lookup = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;

export interface ForwardOptions {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly resolve?: Resolver | undefined;
  /** Replaces the guarded lookup entirely. Tests only. */
  readonly lookup?: Lookup | undefined;
  readonly schedule?: Schedule | undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}

function outboundHeaders(
  request: ForwardRequest,
  payload: Buffer | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "oap-client-relay" };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  if (payload !== undefined) headers["Content-Length"] = String(payload.byteLength);
  return headers;
}

function returnedHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const name of RETURNED_RESPONSE_HEADERS) {
    const value = firstHeader(response.headers[name]);
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/**
 * Forward one read. Resolves once the status line and headers are in, with the
 * body still streaming; rejects with an {@link UpstreamError} if they never
 * arrive.
 */
export function forward(
  endpoint: EndpointConfig,
  request: ForwardRequest,
  options: ForwardOptions,
): Promise<ForwardedResponse> {
  const schedule = options.schedule ?? systemSchedule;
  const payload = request.body === undefined ? undefined : Buffer.from(request.body, "utf8");
  const lookup: Lookup | undefined = endpoint.allowPrivateNetwork
    ? undefined
    : (options.lookup ??
      ((hostname, lookupOptions, callback) => {
        guardedLookup(hostname, lookupOptions, callback, options.resolve);
      }));

  // The deadline covers every hop and the whole body, so it is armed once and
  // whichever stage is live when it fires is the one it ends.
  let onDeadline: () => void = () => undefined;
  const cancelDeadline = schedule(() => {
    onDeadline();
  }, options.timeoutMs);

  const hop = (url: URL, redirectsFollowed: number): Promise<ForwardedResponse> => {
    if (!endpoint.allowPrivateNetwork && isBlockedHost(url.hostname)) {
      return Promise.reject(new UpstreamError("blocked-address"));
    }
    const transport = url.protocol === "https:" ? https : http;

    return new Promise<ForwardedResponse>((resolvePromise, rejectPromise) => {
      let settled = false;
      const fail = (error: UpstreamError): void => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };

      const outgoing = transport.request(url, {
        method: request.method,
        // A fresh socket per hop, so every hop goes through the lookup.
        agent: false,
        headers: outboundHeaders(request, payload),
        ...(lookup === undefined ? {} : { lookup }),
      });

      onDeadline = () => {
        fail(new UpstreamError("timeout"));
        outgoing.destroy();
      };

      outgoing.on("error", (cause: NodeJS.ErrnoException) => {
        const blocked = cause.code === "ENOTFOUND" && cause.message.startsWith("refused:");
        fail(new UpstreamError(blocked ? "blocked-address" : "connection-failed", { cause }));
      });

      outgoing.on("response", (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        const status = response.statusCode ?? 0;

        if (REDIRECT_STATUSES.has(status) && request.method === "GET") {
          const location = firstHeader(response.headers.location);
          const target = location === undefined ? undefined : safeUrl(location, url);
          if (target !== undefined && isUnderBase(target, endpoint.baseUrl)) {
            response.resume();
            settled = true;
            if (redirectsFollowed >= MAX_REDIRECTS) {
              rejectPromise(new UpstreamError("redirect-limit"));
              return;
            }
            hop(target, redirectsFollowed + 1).then(resolvePromise, rejectPromise);
            return;
          }
          // Off the base: handed back as sent, never followed.
        }

        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxResponseBytes) {
          response.destroy();
          fail(new UpstreamError("response-too-large"));
          return;
        }

        settled = true;
        const streamed = streamBody(response, options.maxResponseBytes);
        onDeadline = () => {
          streamed.breakOff("duration");
        };
        void streamed.done.then(() => {
          cancelDeadline();
        });
        resolvePromise({
          status,
          headers: returnedHeaders(response),
          body: NULL_BODY_STATUSES.has(status) ? null : streamed.body,
          finalUrl: url.toString(),
          redirectsFollowed,
          done: streamed.done,
        });
      });

      outgoing.end(payload);
    });
  };

  return hop(request.url, 0).catch((error: unknown) => {
    cancelDeadline();
    throw error;
  });
}

function safeUrl(location: string, base: URL): URL | undefined {
  try {
    return new URL(location, base);
  } catch {
    return undefined;
  }
}

interface StreamedBody {
  readonly body: ReadableStream<Uint8Array>;
  readonly done: Promise<ForwardDone>;
  breakOff(cap: "bytes" | "duration"): void;
}

/**
 * The upstream body as a web stream, with backpressure: the socket is paused
 * while the browser is not reading, so a slow reader costs a paused socket
 * rather than a buffered body.
 */
function streamBody(response: IncomingMessage, maxBytes: number): StreamedBody {
  let bytes = 0;
  let finished = false;
  let resolveDone: (done: ForwardDone) => void = () => undefined;
  const done = new Promise<ForwardDone>((resolve) => {
    resolveDone = resolve;
  });
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const finish = (capHit: ForwardDone["capHit"], error?: Error): void => {
    if (finished) return;
    finished = true;
    if (error === undefined) controller?.close();
    else controller?.error(error);
    resolveDone({ bytes, capHit });
  };

  const breakOff = (cap: "bytes" | "duration"): void => {
    response.destroy();
    finish(cap, new UpstreamError(cap === "bytes" ? "response-too-large" : "timeout"));
  };

  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      response.on("data", (chunk: Buffer) => {
        if (finished) return;
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          breakOff("bytes");
          return;
        }
        // A copy: a socket chunk may be a view into a pool Node reuses.
        streamController.enqueue(Uint8Array.from(chunk));
        if ((streamController.desiredSize ?? 1) <= 0) response.pause();
      });
      response.on("end", () => {
        finish(undefined);
      });
      response.on("error", (cause) => {
        finish(undefined, cause);
      });
      response.on("close", () => {
        // Closed without `end`: the server broke off. Not a cap of ours.
        if (!response.complete) finish(undefined, new UpstreamError("connection-failed"));
      });
    },
    pull() {
      response.resume();
    },
    cancel() {
      // The browser stopped reading. Not a failure; the audit line says how far it got.
      response.destroy();
      if (!finished) {
        finished = true;
        resolveDone({ bytes, capHit: undefined });
      }
    },
  });

  return { body, done, breakOff };
}
