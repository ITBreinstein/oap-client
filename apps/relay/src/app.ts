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
 * It is not a proxy. It does not forward reads, results or dismissals, and it
 * never tells the browser a job's state. The browser polls the OGC server for
 * that, on every doorbell, on every stream reconnect, and on its own schedule
 * when the relay is switched off entirely.
 *
 * ## Routes
 *
 * | Route                                   | Caller      | Auth            |
 * | --------------------------------------- | ----------- | --------------- |
 * | `GET /healthz`                          | operator    | none            |
 * | `GET /endpoints`                        | browser     | none            |
 * | `POST /sessions`                        | browser     | none            |
 * | `GET /sessions/events`                  | browser     | session token   |
 * | `POST /execute/{endpointKey}/{process}` | browser     | session, optional |
 * | `POST /callbacks/{token}/{kind}`        | OGC server  | callback token  |
 */

import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { parseConfig, type EndpointConfig, type RelayConfig } from "./config.js";
import { RelayState, systemClock, type Clock, type RingOutcome } from "./state.js";
import { isWellFormedSecretToken } from "./tokens.js";
import {
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
 * Server ids are chosen by the server, so this admits what both reference
 * servers use — ZOO's `OTB.BandMath` included — and nothing that could change
 * the shape of the URL it is placed into.
 */
const PROCESS_ID = /^[A-Za-z0-9_][A-Za-z0-9._~-]{0,127}$/;

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

export type UpstreamCall = (
  endpoint: EndpointConfig,
  processId: string,
  body: string,
) => Promise<UpstreamResponse>;

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
}

export const DEFAULT_HEARTBEAT_MS = 15_000;

/** An RFC 9457 problem document. `detail` is always ours, never echoed input. */
function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  detail?: string,
): Response {
  return c.json(
    { type: "about:blank", title, status, ...(detail === undefined ? {} : { detail }) },
    status,
    { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
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

  app.onError((error, c) => {
    // The name only: a message can carry a URL, and a URL can carry a token.
    console.error(`relay: unhandled ${error.name}`);
    return problem(c, 500, "Internal Server Error");
  });
  app.notFound((c) => problem(c, 404, "Not Found"));

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
  app.use("/execute/*", browserCors);

  app.get("/endpoints", (c) =>
    c.json({
      endpoints: config.endpoints.map((endpoint) => ({
        key: endpoint.key,
        baseUrl: endpoint.baseUrl,
        executeRoute: endpoint.executeRoute,
        callbacks: endpoint.callbacks,
      })),
    }),
  );

  app.post("/sessions", (c) => {
    const session = state.createSession();
    if (session === undefined) return problem(c, 503, "Service Unavailable", "session capacity");
    return c.json(session, 201, { "Cache-Control": "no-store" });
  });

  app.get("/sessions/events", (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (token === undefined || !isWellFormedSecretToken(token)) {
      return problem(c, 401, "Unauthorized", "unknown session");
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
    if (unsubscribe === undefined) return problem(c, 401, "Unauthorized", "unknown session");

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
      onError: (c) => problem(c, 413, "Content Too Large"),
    }),
    async (c) => {
      const endpoint = endpoints.get(c.req.param("endpointKey"));
      if (endpoint === undefined) return problem(c, 404, "Not Found", "unknown endpoint");
      if (endpoint.executeRoute !== "relay") {
        return problem(c, 409, "Conflict", "this endpoint is executed directly, not via the relay");
      }
      const processId = c.req.param("processId");
      if (!PROCESS_ID.test(processId)) return problem(c, 400, "Bad Request", "invalid process id");

      const mediaType = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
      if (mediaType !== "application/json") {
        return problem(c, 415, "Unsupported Media Type", "send application/json");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await c.req.text());
      } catch {
        return problem(c, 400, "Bad Request", "body is not JSON");
      }
      if (!isPlainObject(parsed)) return problem(c, 400, "Bad Request", "body must be an object");
      if ("subscriber" in parsed) {
        // Callback URLs are the relay's to mint. Accepting the browser's would
        // make the OGC server post wherever a page asked it to.
        return problem(c, 400, "Bad Request", "subscriber is set by the relay");
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
          return problem(c, 401, "Unauthorized", "unknown session");
        }
      }

      let ref: string | undefined;
      let body: Record<string, unknown> = parsed;
      if (endpoint.callbacks && sessionToken !== undefined && config.publicUrl !== undefined) {
        const registration = state.register(sessionToken, endpoint.key);
        if (registration === "unknown-session") {
          return problem(c, 401, "Unauthorized", "unknown session");
        }
        if (registration === "at-capacity") {
          return problem(c, 429, "Too Many Requests", "registration capacity for this session");
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
