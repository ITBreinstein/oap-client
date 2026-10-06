/**
 * Shared fixtures for the SSRF threat matrix (`*.test.ts` in this directory,
 * one file per matrix section, test names carrying the matrix IDs).
 *
 * Nothing here touches a network or real DNS:
 *
 * - {@link stubServer} is a real HTTP server on 127.0.0.1 that counts
 *   *connections*, not only requests, so "no outbound connection was
 *   attempted" is observed at a socket rather than inferred.
 * - {@link table} is an injected resolver. It never asks the system.
 * - {@link dialStub} is the one test-only allowance. It runs the real
 *   `guardedLookup` against an injected resolver, so the guard judges the
 *   answer a deployment would see, and only after the guard accepted it points
 *   the socket at the loopback stub. An answer the guard refuses never reaches
 *   that rewrite, so it is never dialled.
 * - {@link countingApp} is the relay with both outbound requests replaced by
 *   counters, for refusals that must send nothing at all.
 */

import type { LookupAddress } from "node:dns";
import http from "node:http";
import { isIP, type AddressInfo } from "node:net";
import { guardedLookup, type Resolver } from "../../src/address-guard.js";
import { createApp, type AuditLine } from "../../src/app.js";
import { parseConfig, type EndpointConfig, type RelayConfig } from "../../src/config.js";
import type { ForwardedResponse, ForwardRequest, Lookup } from "../../src/forward.js";
import { UpstreamError, type Schedule } from "../../src/exchange.js";
import type { UpstreamResponse } from "../../src/upstream.js";

export const ORIGIN = "http://localhost:4173";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

export interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
}

export interface Stub {
  readonly port: number;
  /** Every TCP connection accepted, whether or not a request followed. */
  readonly connections: number;
  readonly requests: readonly SeenRequest[];
  on(path: string, handler: Handler): void;
  /** Forget handlers and counts, and drop any connection still open. */
  reset(): void;
  close(): Promise<void>;
}

/** A loopback HTTP server. Unknown paths answer 599, which no test expects. */
export async function stubServer(): Promise<Stub> {
  const handlers = new Map<string, Handler>();
  const requests: SeenRequest[] = [];
  let connections = 0;
  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
    });
    const handler = handlers.get(new URL(request.url ?? "/", "http://x").pathname);
    if (handler === undefined) {
      response.writeHead(599).end();
      return;
    }
    handler(request, response);
  });
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  return {
    port: address.port,
    get connections() {
      return connections;
    },
    requests,
    on(path, handler) {
      handlers.set(path, handler);
    },
    reset() {
      server.closeAllConnections();
      handlers.clear();
      requests.length = 0;
      connections = 0;
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/** Per name: fixed answers, or answers by how many times the name was asked (1-based). */
export type Answers = readonly string[] | ((call: number) => readonly string[]);

/**
 * A resolver that answers from a table and records every name it was asked.
 * A name not in the table fails as `getaddrinfo` would.
 */
export function table(entries: Record<string, Answers>, asked: string[] = []): Resolver {
  const answers = new Map(Object.entries(entries));
  return (hostname, _options, callback) => {
    asked.push(hostname);
    const entry = answers.get(hostname);
    if (entry === undefined) {
      const error: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      error.code = "ENOTFOUND";
      callback(error, []);
      return;
    }
    const call = asked.filter((name) => name === hostname).length;
    const addresses = typeof entry === "function" ? entry(call) : entry;
    callback(
      null,
      addresses.map((address): LookupAddress => ({ address, family: isIP(address) === 6 ? 6 : 4 })),
    );
  };
}

/**
 * The real guarded lookup over `resolve`, dialling loopback only once the guard
 * accepted the answer. Records every name the connection asked for.
 */
export function dialStub(resolve: Resolver, asked: string[] = []): Lookup {
  return (hostname, options, callback) => {
    asked.push(hostname);
    guardedLookup(
      hostname,
      options,
      (error, address, family) => {
        if (error !== null) {
          callback(error, address, family);
          return;
        }
        if (Array.isArray(address)) callback(null, [{ address: "127.0.0.1", family: 4 }]);
        else callback(null, "127.0.0.1", 4);
      },
      resolve,
    );
  };
}

/** A public-address endpoint: `allowPrivateNetwork` off, so the guard is in force. */
export function publicEndpoint(
  baseUrl: string,
  overrides: Partial<EndpointConfig> = {},
): EndpointConfig {
  return {
    key: "testbed",
    baseUrl,
    executeRoute: "relay",
    readRoute: "relay",
    callbacks: false,
    allowPrivateNetwork: false,
    ...overrides,
  };
}

/**
 * A config holding exactly these endpoints, built around `parseConfig` rather
 * than through it, so fixtures on loopback or plain `http:` do not depend on
 * what the config parser accepts at startup (matrix G tests that separately).
 */
export function relayConfig(
  endpoints: readonly EndpointConfig[],
  limits: Partial<RelayConfig["limits"]> = {},
): RelayConfig {
  const parsed = parseConfig({ allowedOrigins: [ORIGIN], endpoints: [] });
  return { ...parsed, endpoints, limits: { ...parsed.limits, ...limits } };
}

/** A `Schedule` whose deadlines never fire, so only a cap can end an exchange. */
export const never: Schedule = () => () => undefined;

/** A `Schedule` whose deadlines fire when the test says so. */
export function manualSchedule(): { readonly schedule: Schedule; fire(): void } {
  const pending = new Set<() => void>();
  return {
    schedule: (callback) => {
      pending.add(callback);
      return () => {
        pending.delete(callback);
      };
    },
    fire: () => {
      for (const callback of [...pending]) callback();
    },
  };
}

/** The `UpstreamError` reason a promise rejected with. */
export async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpstreamError) return error.reason;
    throw error;
  }
  throw new Error("expected the exchange to fail");
}

type App = ReturnType<typeof createApp>;

/** A live session token from `app`. */
export async function sessionToken(app: App): Promise<string> {
  const body: unknown = await (await app.request("/sessions", { method: "POST" })).json();
  if (typeof body !== "object" || body === null || !("token" in body)) throw new Error("no token");
  const { token } = body;
  if (typeof token !== "string") throw new Error("token is not a string");
  return token;
}

/** A request to `app` from the allowed origin, with a fresh session. */
export async function browserRequest(
  app: App,
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  } = {},
): Promise<Response> {
  const token = await sessionToken(app);
  return app.request(path, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN, ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

const CREATED: UpstreamResponse = {
  status: 201,
  location: undefined,
  contentType: "application/json",
  preferenceApplied: "respond-async",
  body: "{}",
};

export interface CountingApp {
  readonly app: App;
  /** Every read-route request and synchronous execute the app tried to send. */
  readonly forwarded: ForwardRequest[];
  /** Every asynchronous execute the app tried to send, as `endpointKey/processId`. */
  readonly executed: string[];
  readonly audits: AuditLine[];
}

/** The relay, with both outbound requests replaced by counters that answer 200 / 201. */
export function countingApp(config: RelayConfig): CountingApp {
  const forwarded: ForwardRequest[] = [];
  const executed: string[] = [];
  const audits: AuditLine[] = [];
  const app = createApp({
    config,
    schedule: never,
    forward: (_endpoint, request) => {
      forwarded.push(request);
      const answer: ForwardedResponse = {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        body: null,
        finalUrl: request.url.toString(),
        redirectsFollowed: 0,
        done: Promise.resolve({ bytes: 0, capHit: undefined }),
      };
      return Promise.resolve(answer);
    },
    upstream: (endpoint, processId) => {
      executed.push(`${endpoint.key}/${processId}`);
      return Promise.resolve(CREATED);
    },
    onAudit: (line) => audits.push(line),
  });
  return { app, forwarded, executed, audits };
}
