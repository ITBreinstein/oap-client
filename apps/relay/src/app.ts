/**
 * The relay: a narrow helper for the two things a browser cannot do against
 * the reference servers, and nothing more.
 *
 * 1. **Name the job it just started** (route B, finding 0039). The browser asks
 *    the relay to send one asynchronous execute to one configured endpoint;
 *    the relay reads `Location` — which a browser cannot, cross-origin — and
 *    hands it back.
 * 2. **Hear that a job changed** without polling hard. The relay receives the
 *    OGC server's callbacks and rings a doorbell on the browser's event stream:
 *    "something happened to job X", never what.
 *
 * 3. **Read a server that sends no CORS headers** (phase 3, finding 0050) —
 *    only for endpoints configured with `readRoute: "relay"`, only under their
 *    `baseUrl`, and only after the user confirmed the fallback in the web app.
 *
 * It is not a general proxy: it never takes a URL from the browser, and an
 * endpoint without `readRoute: "relay"` gets nothing forwarded but its
 * asynchronous executes. It never tells the browser a job's state from its
 * callbacks; the browser polls for that, on every doorbell, on every stream
 * reconnect, and on its own schedule when the relay is switched off.
 *
 * ## Routes
 *
 * | Route                                   | Caller      | Auth            |
 * | --------------------------------------- | ----------- | --------------- |
 * | `GET /healthz`                          | operator    | none            |
 * | `GET /endpoints`                        | browser     | none            |
 * | `POST /sessions`                        | browser     | none            |
 * | `GET /sessions/events`                  | browser     | session token   |
 * | `POST /execute/{endpointKey}/{process}` | browser     | session¹        |
 * | `GET /read/{endpointKey}/{path*}`       | browser     | session token   |
 * | `DELETE /read/{endpointKey}/jobs/{id}`  | browser     | session token   |
 * | `POST /callbacks/{token}/{kind}`        | OGC server  | callback token  |
 *
 * ¹ Optional for an asynchronous execute; required for a synchronous one on a
 * read-route endpoint, which is a read in all but method.
 *
 * Every response carries `X-Relay: 1`; every response the relay generates
 * itself, rather than forwards, also carries `X-Relay-Error: <code>`.
 */

import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { parseConfig, PROCESS_ID, type EndpointConfig, type RelayConfig } from "./config.js";
import {
  forward as forwardUpstream,
  isJobResource,
  resolveReadTarget,
  type ForwardedResponse,
  type ForwardRequest,
} from "./forward.js";
import { RelayState, systemClock, type Clock, type RingOutcome } from "./state.js";
import { isWellFormedSecretToken } from "./tokens.js";
import {
  executionUrl,
  postExecute,
  systemSchedule,
  UpstreamError,
  type Schedule,
  type UpstreamFailure,
  type UpstreamResponse,
} from "./upstream.js";

/** The three `subscriber` members, as path segments. */
export const CALLBACK_KINDS = ["success", "in-progress", "failed"] as const;
export type CallbackKind = (typeof CALLBACK_KINDS)[number];

function isCallbackKind(value: string): value is CallbackKind {
  return CALLBACK_KINDS.some((kind) => kind === value);
}

/**
 * What happened, for tests and operators. Carries no token, no URL and no
 * request content — only which branch was taken.
 */
export type RelayEvent =
  | {
      readonly kind: "callback";
      readonly callbackKind: CallbackKind;
      readonly outcome: RingOutcome;
    }
  | {
      readonly kind: "execute";
      readonly endpointKey: string;
      readonly outcome: "relayed" | UpstreamFailure;
      readonly upstreamStatus: number | undefined;
      readonly registered: boolean;
    }
  | { readonly kind: "stream"; readonly change: "opened" | "closed" };

/**
 * One line per forwarded request on the read route, and per synchronous
 * execute forwarded for a read-route endpoint. Redacted at creation: the path
 * relative to the endpoint's base, and the *names* of query parameters, never
 * their values. No body, no token, no header.
 */
export interface AuditLine {
  readonly audit: "read-route";
  readonly endpointKey: string;
  readonly method: "GET" | "DELETE" | "POST";
  readonly path: string;
  readonly queryNames: readonly string[];
  /** Undefined when no response arrived. */
  readonly upstreamStatus: number | undefined;
  /** Why no response arrived, or why the body was broken off. */
  readonly failure: UpstreamFailure | undefined;
  readonly redirectsFollowed: number;
  readonly bytes: number;
  readonly ms: number;
  readonly capHit: "bytes" | "duration" | undefined;
}

export type UpstreamCall = (
  endpoint: EndpointConfig,
  processId: string,
  body: string,
) => Promise<UpstreamResponse>;

/** The read route's outbound request. `forward` with the configured limits by default. */
export type ForwardCall = (
  endpoint: EndpointConfig,
  request: ForwardRequest,
) => Promise<ForwardedResponse>;

export interface AppOptions {
  readonly config?: RelayConfig | undefined;
  readonly state?: RelayState | undefined;
  readonly clock?: Clock | undefined;
  /** The outbound execute. `postExecute` with the configured limits by default. */
  readonly upstream?: UpstreamCall | undefined;
  /** Scheduler for the stream heartbeat. */
  readonly schedule?: Schedule | undefined;
  /** Comment line on each open stream this often, so proxies keep it open. */
  readonly heartbeatMs?: number | undefined;
  readonly onEvent?: ((event: RelayEvent) => void) | undefined;
  readonly forward?: ForwardCall | undefined;
  /** Where audit lines go. One JSON line on stdout by default. */
  readonly onAudit?: ((line: AuditLine) => void) | undefined;
}

/** `[a-z0-9-]`, as the config allows. Checked again here because it is placed in a path prefix. */
const ENDPOINT_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

function queryNames(search: string): string[] {
  return [...new Set(new URLSearchParams(search).keys())].sort();
}

/** The redacted half of an audit line that is known before anything is sent. */
function auditBase(
  endpoint: EndpointConfig,
  request: ForwardRequest,
): Pick<AuditLine, "audit" | "endpointKey" | "method" | "path" | "queryNames"> {
  const basePath = new URL(endpoint.baseUrl).pathname.replace(/\/+$/, "");
  return {
    audit: "read-route",
    endpointKey: endpoint.key,
    method: request.method,
    path: request.url.pathname.slice(basePath.length) || "/",
    queryNames: queryNames(request.url.search),
  };
}

export const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * On every response the relay sends, forwarded or its own. A response without
 * it did not come from the relay — in a public deployment, a reverse proxy in
 * front of it answers 502 or 504 by itself when the relay is down — and the
 * web app must not read that as the OGC server's answer.
 */
export const RELAY_MARKER = "X-Relay";

/**
 * On every response the relay generates itself rather than forwards: its
 * refusals and its own failures. The value is a code, never a message. The web
 * app turns such a response into an error instead of handing it to the core
 * as though the OGC server had said it.
 */
export const RELAY_ERROR = "X-Relay-Error";

/** What a browser may read off a forwarded response: the evidence, and the two markers. */
export const EXPOSED_HEADERS = [
  "Content-Type",
  "Content-Length",
  "Content-Crs",
  "Content-Disposition",
  "Location",
  "Retry-After",
  "Link",
  "Preference-Applied",
  RELAY_MARKER,
  RELAY_ERROR,
];

/**
 * An RFC 9457 problem document, marked as the relay's own. `detail` is always
 * ours, never echoed input.
 */
function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  code: string,
  detail?: string,
): Response {
  return c.json(
    { type: "about:blank", title, status, ...(detail === undefined ? {} : { detail }) },
    status,
    {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      [RELAY_ERROR]: code,
    },
  );
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
  return match?.[1];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The relay application, exported without a listener so tests can call it. */
export function createApp(options: AppOptions = {}): Hono {
  const config = options.config ?? parseConfig({ endpoints: [] });
  const clock = options.clock ?? systemClock;
  const state =
    options.state ??
    new RelayState(clock, {
      registrationTtlMs: config.registrationTtlMs,
      sessionIdleTtlMs: config.sessionIdleTtlMs,
      maxSessions: config.limits.maxSessions,
      maxRegistrationsPerSession: config.limits.maxRegistrationsPerSession,
    });
  const upstream: UpstreamCall =
    options.upstream ??
    ((endpoint, processId, body) =>
      postExecute(endpoint, processId, body, {
        timeoutMs: config.limits.upstreamTimeoutMs,
        maxResponseBytes: config.limits.maxUpstreamResponseBytes,
      }));
  const forward: ForwardCall =
    options.forward ??
    ((endpoint, request) =>
      forwardUpstream(endpoint, request, {
        timeoutMs: config.limits.readTimeoutMs,
        maxResponseBytes: config.limits.maxReadResponseBytes,
      }));
  const audit = (line: AuditLine): void => {
    try {
      if (options.onAudit === undefined) console.log(JSON.stringify(line));
      else options.onAudit(line);
    } catch {
      // An audit sink must not be able to break a read.
    }
  };
  const schedule = options.schedule ?? systemSchedule;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const emit = (event: RelayEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      // An observer must not be able to break a callback answer.
    }
  };
  const endpoints = new Map(config.endpoints.map((endpoint) => [endpoint.key, endpoint]));
  const allowedOrigins = new Set(config.allowedOrigins);

  const app = new Hono();

  // First, so it wraps everything below — CORS preflights, refusals, the
  // not-found and error handlers, forwarded responses.
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set(RELAY_MARKER, "1");
  });

  app.onError((error, c) => {
    // The name only: a message can carry a URL, and a URL can carry a token.
    console.error(`relay: unhandled ${error.name}`);
    return problem(c, 500, "Internal Server Error", "internal-error");
  });
  app.notFound((c) => problem(c, 404, "Not Found", "not-found"));

  app.get("/healthz", (c) => c.json({ ok: true }));

  // The browser-facing routes. The callback routes are server-to-server and
  // get no CORS headers at all.
  const browserCors = cors({
    origin: (origin) => (allowedOrigins.has(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 600,
  });
  app.use("/endpoints", browserCors);
  app.use("/sessions", browserCors);
  app.use("/sessions/*", browserCors);

  // The routes that can hand back an OGC server's answer. They expose the
  // evidence headers, so the core sees what it would see from a server that
  // sends perfect CORS headers, and accept the request headers the read route
  // forwards.
  const forwardingCors = cors({
    origin: (origin) => (allowedOrigins.has(origin) ? origin : null),
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Prefer", "Accept-Language"],
    exposeHeaders: EXPOSED_HEADERS,
    credentials: false,
    maxAge: 600,
  });
  app.use("/execute/*", forwardingCors);
  app.use("/read/*", forwardingCors);

  /** The relay's `Response` for a forwarded answer, and its audit line once the body is done. */
  const relayForwarded = (
    endpoint: EndpointConfig,
    request: ForwardRequest,
    started: number,
    forwarded: ForwardedResponse,
  ): Response => {
    void forwarded.done.then((done) => {
      audit({
        ...auditBase(endpoint, request),
        upstreamStatus: forwarded.status,
        failure:
          done.capHit === "bytes"
            ? "response-too-large"
            : done.capHit === "duration"
              ? "timeout"
              : undefined,
        redirectsFollowed: forwarded.redirectsFollowed,
        bytes: done.bytes,
        ms: clock.now() - started,
        capHit: done.capHit,
      });
    });
    const headers = new Headers(forwarded.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(NULL_BODY_STATUSES.has(forwarded.status) ? null : forwarded.body, {
      status: forwarded.status,
      headers,
    });
  };

  /** The relay's own 502 for an exchange that produced no response. */
  const upstreamFailed = (
    c: Context,
    endpoint: EndpointConfig,
    request: ForwardRequest,
    started: number,
    error: unknown,
  ): Response => {
    const reason: UpstreamFailure =
      error instanceof UpstreamError ? error.reason : "connection-failed";
    audit({
      ...auditBase(endpoint, request),
      upstreamStatus: undefined,
      failure: reason,
      redirectsFollowed: error instanceof UpstreamError ? error.redirectsFollowed : 0,
      bytes: 0,
      ms: clock.now() - started,
      capHit:
        reason === "response-too-large" ? "bytes" : reason === "timeout" ? "duration" : undefined,
    });
    return c.json({ type: "about:blank", title: "Bad Gateway", status: 502, reason }, 502, {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      [RELAY_ERROR]: reason,
    });
  };

  // The read route (phase 3; finding 0050). Only for endpoints configured for
  // it, only under their base, and only with a live session. The web app sends
  // nothing here until the server failed directly and the user confirmed.
  const read = async (c: Context, method: "GET" | "DELETE"): Promise<Response> => {
    const endpoint = endpoints.get(c.req.param("endpointKey") ?? "");
    if (endpoint === undefined || !ENDPOINT_KEY.test(endpoint.key)) {
      return problem(c, 404, "Not Found", "unknown-endpoint", "unknown endpoint");
    }
    if (endpoint.readRoute !== "relay") {
      return problem(
        c,
        403,
        "Forbidden",
        "read-route-off",
        "this endpoint is not configured for the read route",
      );
    }
    const token = bearerToken(c.req.header("Authorization"));
    if (token === undefined || !isWellFormedSecretToken(token) || !state.touchSession(token)) {
      return problem(c, 401, "Unauthorized", "unknown-session", "unknown session");
    }

    const own = new URL(c.req.url);
    const prefix = `/read/${endpoint.key}`;
    const rest = own.pathname.slice(prefix.length);
    if (!own.pathname.startsWith(prefix) || (rest !== "" && !rest.startsWith("/"))) {
      return problem(c, 404, "Not Found", "not-found");
    }
    const target = resolveReadTarget(endpoint, rest, own.search);
    if (typeof target === "string") return problem(c, 400, "Bad Request", target);
    if (method === "DELETE" && !isJobResource(endpoint, target)) {
      return problem(
        c,
        405,
        "Method Not Allowed",
        "delete-not-a-job",
        "DELETE is forwarded for a job only",
      );
    }

    const request: ForwardRequest = { method, url: target, headers: c.req.raw.headers };
    const started = clock.now();
    // Only the exchange is in the try: a fault of ours after the server
    // answered is the error handler's 500, not the server's 502.
    let forwarded: ForwardedResponse;
    try {
      forwarded = await forward(endpoint, request);
    } catch (error) {
      return upstreamFailed(c, endpoint, request, started, error);
    }
    return relayForwarded(endpoint, request, started, forwarded);
  };
  app.get("/read/:endpointKey", (c) => read(c, "GET"));
  app.get("/read/:endpointKey/*", (c) => read(c, "GET"));
  app.delete("/read/:endpointKey/*", (c) => read(c, "DELETE"));

  app.get("/endpoints", (c) =>
    c.json({
      endpoints: config.endpoints.map((endpoint) => ({
        key: endpoint.key,
        baseUrl: endpoint.baseUrl,
        executeRoute: endpoint.executeRoute,
        readRoute: endpoint.readRoute,
        callbacks: endpoint.callbacks,
        processes: endpoint.processes,
      })),
    }),
  );

  app.post("/sessions", (c) => {
    const session = state.createSession();
    if (session === undefined)
      return problem(c, 503, "Service Unavailable", "session-capacity", "session capacity");
    return c.json(session, 201, { "Cache-Control": "no-store" });
  });

  app.get("/sessions/events", (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (token === undefined || !isWellFormedSecretToken(token)) {
      return problem(c, 401, "Unauthorized", "unknown-session", "unknown session");
    }

    // Subscribe before streaming, so a doorbell rung between the check and the
    // first write is held rather than lost. `pending` is also the coalescing:
    // a ref already waiting to be written is not queued twice, so a burst of
    // callbacks for one job — ZOO sends one a second (finding 0048) — becomes
    // one event.
    const pending = new Set<string>();
    let wake: (() => void) | undefined;
    const unsubscribe = state.listen(token, (ref) => {
      pending.add(ref);
      wake?.();
    });
    if (unsubscribe === undefined)
      return problem(c, 401, "Unauthorized", "unknown-session", "unknown session");

    c.header("Cache-Control", "no-store");
    return streamSSE(c, async (stream) => {
      emit({ kind: "stream", change: "opened" });
      // Mutated from callbacks, so kept on an object: a `let` here is narrowed
      // to its initial value by the checker, which cannot see the callbacks.
      const flags = { open: true, heartbeatDue: false };
      let cancelHeartbeat = (): void => undefined;
      const armHeartbeat = (): void => {
        cancelHeartbeat = schedule(() => {
          flags.heartbeatDue = true;
          wake?.();
          armHeartbeat();
        }, heartbeatMs);
      };

      const closed = new Promise<void>((resolve) => {
        stream.onAbort(() => {
          flags.open = false;
          resolve();
          wake?.();
        });
      });

      try {
        await stream.writeSSE({ event: "ready", data: "{}" });
        armHeartbeat();
        while (flags.open) {
          const ref = pending.values().next();
          if (!ref.done) {
            pending.delete(ref.value);
            await stream.writeSSE({ event: "job", data: JSON.stringify({ ref: ref.value }) });
            continue;
          }
          if (flags.heartbeatDue) {
            flags.heartbeatDue = false;
            await stream.write(": keepalive\n\n");
            continue;
          }
          await Promise.race([
            closed,
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
          ]);
          wake = undefined;
        }
      } finally {
        cancelHeartbeat();
        unsubscribe();
        emit({ kind: "stream", change: "closed" });
      }
    });
  });

  app.post(
    "/execute/:endpointKey/:processId",
    bodyLimit({
      maxSize: config.limits.maxExecuteBodyBytes,
      onError: (c) => problem(c, 413, "Content Too Large", "body-too-large"),
    }),
    async (c) => {
      const endpoint = endpoints.get(c.req.param("endpointKey"));
      if (endpoint === undefined)
        return problem(c, 404, "Not Found", "unknown-endpoint", "unknown endpoint");
      if (endpoint.executeRoute !== "relay") {
        return problem(
          c,
          409,
          "Conflict",
          "execute-direct",
          "this endpoint is executed directly, not via the relay",
        );
      }
      const processId = c.req.param("processId");
      if (!PROCESS_ID.test(processId))
        return problem(c, 400, "Bad Request", "invalid-process-id", "invalid process id");

      const mediaType = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") {
        return problem(
          c,
          415,
          "Unsupported Media Type",
          "unsupported-media-type",
          "send application/json",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await c.req.text());
      } catch {
        return problem(c, 400, "Bad Request", "body-not-json", "body is not JSON");
      }
      if (!isPlainObject(parsed))
        return problem(c, 400, "Bad Request", "body-not-object", "body must be an object");
      if ("subscriber" in parsed) {
        // Callback URLs are the relay's to mint. Accepting the browser's would
        // make the OGC server post wherever a page asked it to.
        return problem(
          c,
          400,
          "Bad Request",
          "subscriber-refused",
          "subscriber is set by the relay",
        );
      }

      // A session is optional: without one the job simply has no doorbell,
      // and the browser polls. With one that is not live, refuse *before*
      // sending — no job exists yet, so nothing is orphaned by refusing.
      const authorization = c.req.header("Authorization");
      const sessionToken = bearerToken(authorization);
      if (authorization !== undefined) {
        if (
          sessionToken === undefined ||
          !isWellFormedSecretToken(sessionToken) ||
          !state.touchSession(sessionToken)
        ) {
          return problem(c, 401, "Unauthorized", "unknown-session", "unknown session");
        }
      }

      // A synchronous execute for a read-route endpoint: its answer is the
      // result itself, which the browser cannot read from this server, so it
      // is forwarded raw like a read — the browser's own `Prefer`, streamed
      // back under the read route's caps. No callbacks: nothing to ring for.
      const prefer = c.req.header("Prefer") ?? "";
      if (endpoint.readRoute === "relay" && !/\brespond-async\b/i.test(prefer)) {
        // A read in all but method, so it needs a session as the read route does.
        if (sessionToken === undefined) {
          return problem(c, 401, "Unauthorized", "unknown-session", "unknown session");
        }
        const request: ForwardRequest = {
          method: "POST",
          url: executionUrl(endpoint, processId),
          headers: c.req.raw.headers,
          body: JSON.stringify(parsed),
        };
        const started = clock.now();
        let forwarded: ForwardedResponse;
        try {
          forwarded = await forward(endpoint, request);
        } catch (error) {
          emit({
            kind: "execute",
            endpointKey: endpoint.key,
            outcome: error instanceof UpstreamError ? error.reason : "connection-failed",
            upstreamStatus: undefined,
            registered: false,
          });
          return upstreamFailed(c, endpoint, request, started, error);
        }
        emit({
          kind: "execute",
          endpointKey: endpoint.key,
          outcome: "relayed",
          upstreamStatus: forwarded.status,
          registered: false,
        });
        return relayForwarded(endpoint, request, started, forwarded);
      }

      let ref: string | undefined;
      let body: Record<string, unknown> = parsed;
      if (endpoint.callbacks && sessionToken !== undefined && config.publicUrl !== undefined) {
        const registration = state.register(sessionToken, endpoint.key);
        if (registration === "unknown-session") {
          return problem(c, 401, "Unauthorized", "unknown-session", "unknown session");
        }
        if (registration === "at-capacity") {
          return problem(
            c,
            429,
            "Too Many Requests",
            "registration-capacity",
            "registration capacity for this session",
          );
        }
        ref = registration.ref;
        const base = `${config.publicUrl}/callbacks/${registration.callbackToken}`;
        body = {
          ...parsed,
          subscriber: {
            successUri: `${base}/success`,
            inProgressUri: `${base}/in-progress`,
            failedUri: `${base}/failed`,
          },
        };
      }

      let response: UpstreamResponse;
      try {
        response = await upstream(endpoint, processId, JSON.stringify(body));
      } catch (error) {
        if (ref !== undefined) state.release(ref);
        const reason: UpstreamFailure =
          error instanceof UpstreamError ? error.reason : "connection-failed";
        emit({
          kind: "execute",
          endpointKey: endpoint.key,
          outcome: reason,
          upstreamStatus: undefined,
          registered: false,
        });
        return c.json({ type: "about:blank", title: "Bad Gateway", status: 502, reason }, 502, {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
          [RELAY_ERROR]: reason,
        });
      }

      // No job, no doorbell. The registration would otherwise sit until its TTL.
      const created = response.status >= 200 && response.status < 300;
      if (!created && ref !== undefined) {
        state.release(ref);
        ref = undefined;
      }
      emit({
        kind: "execute",
        endpointKey: endpoint.key,
        outcome: "relayed",
        upstreamStatus: response.status,
        registered: ref !== undefined,
      });
      return c.json({ upstream: response, registration: ref === undefined ? null : { ref } }, 200, {
        "Cache-Control": "no-store",
      });
    },
  );

  // A notification from an OGC server. The token is checked before anything
  // else, and the request body is never read: not as job state, not as a job
  // id, not at all. Node discards whatever the server sent after we answer.
  //
  // An unknown or expired token is answered 404, never refused at the socket.
  // pygeoapi 0.21.0 ignores the status of a callback response but treats a
  // refused or reset connection as a failure of the job itself (finding 0047),
  // so "answer everything, promptly" is what keeps a relay restart from
  // damaging jobs on the server.
  app.post("/callbacks/:token/:kind", (c) => {
    const kind = c.req.param("kind");
    const token = c.req.param("token");
    if (!isCallbackKind(kind) || !isWellFormedSecretToken(token)) {
      return c.body(null, 404, { "Cache-Control": "no-store" });
    }
    const outcome = state.ring(token);
    emit({ kind: "callback", callbackKind: kind, outcome });
    return c.body(null, outcome === "unknown" ? 404 : 200, { "Cache-Control": "no-store" });
  });

  return app;
}
