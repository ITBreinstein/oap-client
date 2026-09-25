/**
 * The read route's outbound request, against a real HTTP server on loopback.
 *
 * Not msw: msw answers above the socket, so under it neither the per-hop
 * lookup nor streaming backpressure would run. The endpoint here is a
 * *public-address* config — `allowPrivateNetwork: false` — whose name an
 * injected lookup maps to 127.0.0.1, so the address guard is in the path of
 * every hop exactly as in a public deployment, and nothing leaves the machine.
 * The one test of the default guard injects a resolver instead, which refuses
 * before any connection is attempted.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Resolver } from "../src/address-guard.js";
import type { EndpointConfig } from "../src/config.js";
import {
  forward,
  isJobResource,
  isUnderBase,
  MAX_REDIRECTS,
  resolveReadTarget,
  type ForwardRequest,
  type Lookup,
} from "../src/forward.js";
import { UpstreamError, type Schedule } from "../src/upstream.js";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

const handlers = new Map<string, Handler>();
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders }[] = [];
const server = http.createServer((request, response) => {
  seen.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers });
  const path = new URL(request.url ?? "/", "http://x").pathname;
  const handler = handlers.get(path);
  if (handler === undefined) {
    response.writeHead(599).end();
    return;
  }
  handler(request, response);
});

let port = 0;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  port = address.port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const HOST = "ogc.public.test";
const base = (): string => `http://${HOST}:${String(port)}/api`;

/** A public-address endpoint: the guard is in force. */
const endpoint = (): EndpointConfig => ({
  key: "public",
  baseUrl: base(),
  executeRoute: "relay",
  readRoute: "relay",
  callbacks: false,
  allowPrivateNetwork: false,
});

/** Maps every name to loopback, and records each name it was asked for. */
function loopbackLookup(asked: string[], refuseFrom = Number.POSITIVE_INFINITY): Lookup {
  return (hostname, options, callback) => {
    asked.push(hostname);
    if (asked.length >= refuseFrom) {
      const error: NodeJS.ErrnoException = new Error(
        `refused: ${hostname} resolves to a blocked address`,
      );
      error.code = "ENOTFOUND";
      callback(error, "", 4);
      return;
    }
    if (options.all === true) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  };
}

function get(path: string, headers: Record<string, string> = {}): ForwardRequest {
  return { method: "GET", url: new URL(`${base()}${path}`), headers: new Headers(headers) };
}

const limits = { timeoutMs: 5_000, maxResponseBytes: 1_024 };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpstreamError) return error.reason;
    throw error;
  }
  throw new Error("expected the exchange to fail");
}

describe("resolveReadTarget", () => {
  const zoo: EndpointConfig = {
    key: "zoo",
    baseUrl: "http://localhost:5090/ogc-api",
    executeRoute: "relay",
    readRoute: "relay",
    callbacks: false,
    allowPrivateNetwork: true,
  };

  it("builds the URL from the base, the relative path and the query, verbatim", () => {
    const url = resolveReadTarget(zoo, "/processes", "?f=json&limit=10&q=a%20b");
    expect(url instanceof URL ? url.href : url).toBe(
      "http://localhost:5090/ogc-api/processes?f=json&limit=10&q=a%20b",
    );
    const root = resolveReadTarget(zoo, "", "");
    expect(root instanceof URL ? root.href : root).toBe("http://localhost:5090/ogc-api");
    const slash = resolveReadTarget(zoo, "/", "");
    expect(slash instanceof URL ? slash.href : slash).toBe("http://localhost:5090/ogc-api/");
  });

  it.each([
    ["a scheme in the first segment", "/http:/evil.example/x"],
    ["a protocol-relative path", "//evil.example/x"],
    ["a path without its leading slash", "evil"],
  ])("refuses an absolute URL: %s", (_, path) => {
    expect(resolveReadTarget(zoo, path, "")).toBe("absolute-url");
  });

  it.each([
    ["..", "/processes/../../etc"],
    [".", "/./processes"],
    ["%2e%2e", "/jobs/%2e%2e/x"],
    ["%2E.", "/jobs/%2E./x"],
  ])("refuses a dot segment: %s", (_, path) => {
    expect(resolveReadTarget(zoo, path, "")).toBe("dot-segment");
  });

  it.each([
    ["%2F", "/jobs/..%2F..%2Fadmin"],
    ["%5c", "/jobs/a%5cb"],
    ["a backslash", "/jobs/a\\b"],
    ["broken percent-encoding", "/jobs/%zz"],
  ])("refuses an encoded separator: %s", (_, path) => {
    expect(resolveReadTarget(zoo, path, "")).toBe("encoded-separator");
  });

  it("compares normalised URLs, not string prefixes", () => {
    expect(isUnderBase(new URL("http://localhost:5090/ogc-api-evil/x"), zoo.baseUrl)).toBe(false);
    expect(isUnderBase(new URL("http://localhost:5091/ogc-api/x"), zoo.baseUrl)).toBe(false);
    expect(isUnderBase(new URL("https://localhost:5090/ogc-api/x"), zoo.baseUrl)).toBe(false);
    expect(isUnderBase(new URL("http://LOCALHOST:5090/ogc-api/x"), zoo.baseUrl)).toBe(true);
    expect(isUnderBase(new URL("http://localhost:5090/ogc-api"), zoo.baseUrl)).toBe(true);
    expect(isUnderBase(new URL("http://h/anything"), "http://h")).toBe(true);
  });

  it("names one job and nothing else as a job resource", () => {
    const at = (path: string): boolean => isJobResource(zoo, new URL(`${zoo.baseUrl}${path}`));
    expect(at("/jobs/abc-123")).toBe(true);
    expect(at("/jobs")).toBe(false);
    expect(at("/jobs/")).toBe(false);
    expect(at("/jobs/abc/results")).toBe(false);
    expect(at("/processes/echo")).toBe(false);
  });
});

describe("forward", () => {
  it("sends only the allowlisted request headers, and its own User-Agent", async () => {
    handlers.set("/api/processes", (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
    const asked: string[] = [];
    const forwarded = await forward(
      endpoint(),
      get("/processes", {
        Accept: "application/json",
        "Accept-Language": "nl",
        Prefer: "return=minimal",
        Cookie: "session=abc",
        Authorization: "Bearer relay-session-token",
        Origin: "http://localhost:4173",
        "X-Forwarded-For": "10.0.0.1",
        "User-Agent": "Mozilla/5.0",
      }),
      { ...limits, lookup: loopbackLookup(asked) },
    );
    await new Response(forwarded.body).text();

    const headers = seen.at(-1)?.headers ?? {};
    expect(headers["accept"]).toBe("application/json");
    expect(headers["accept-language"]).toBe("nl");
    expect(headers["prefer"]).toBe("return=minimal");
    expect(headers["user-agent"]).toBe("oap-client-relay");
    expect(headers["cookie"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
    expect(headers["origin"]).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
  });

  it("passes back the evidence headers unchanged, and no others", async () => {
    const evidence = {
      "Content-Type": "image/png",
      "Content-Length": "3",
      "Content-Crs": "<http://www.opengis.net/def/crs/EPSG/0/28992>",
      "Content-Disposition": 'attachment; filename="result.png"',
      Location: `${base()}/jobs/42`,
      "Retry-After": "5",
      Link: '<./results>; rel="results"',
      "Preference-Applied": "respond-async",
    };
    handlers.set("/api/jobs/42/results", (_request, response) => {
      response
        .writeHead(200, {
          ...evidence,
          "Set-Cookie": "tracking=1",
          "X-Powered-By": "pygeoapi 0.21.0",
          "Access-Control-Allow-Origin": "*",
          "Content-Security-Policy": "default-src 'self'",
        })
        .end("png");
    });
    const forwarded = await forward(endpoint(), get("/jobs/42/results"), {
      ...limits,
      lookup: loopbackLookup([]),
    });
    await new Response(forwarded.body).text();

    const names = [...forwarded.headers.keys()].sort();
    expect(names).toEqual(
      Object.keys(evidence)
        .map((name) => name.toLowerCase())
        .sort(),
    );
    for (const [name, value] of Object.entries(evidence)) {
      expect(forwarded.headers.get(name)).toBe(value);
    }
  });

  it("preserves the query string verbatim", async () => {
    handlers.set("/api/jobs", (_request, response) => {
      response.writeHead(200).end("[]");
    });
    const forwarded = await forward(endpoint(), get("/jobs?limit=2&status=running&q=a%20b"), {
      ...limits,
      lookup: loopbackLookup([]),
    });
    await new Response(forwarded.body).text();
    expect(seen.at(-1)?.url).toBe("/api/jobs?limit=2&status=running&q=a%20b");
  });

  it("streams a body larger than the socket's chunks, whole", async () => {
    const big = "x".repeat(200_000);
    handlers.set("/api/big", (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write(big.slice(0, 100_000));
      setImmediate(() => response.end(big.slice(100_000)));
    });
    const forwarded = await forward(endpoint(), get("/big"), {
      timeoutMs: 5_000,
      maxResponseBytes: 1_000_000,
      lookup: loopbackLookup([]),
    });
    expect(await new Response(forwarded.body).text()).toBe(big);
    await expect(forwarded.done).resolves.toEqual({ bytes: 200_000, capHit: undefined });
  });

  it("refuses a declared body over the byte cap before streaming anything", async () => {
    handlers.set("/api/declared", (_request, response) => {
      response.writeHead(200, { "Content-Length": "2048" }).end("y".repeat(2048));
    });
    const reason = await failure(
      forward(endpoint(), get("/declared"), { ...limits, lookup: loopbackLookup([]) }),
    );
    expect(reason).toBe("response-too-large");
  });

  it("breaks off an undeclared body at the byte cap, and says which cap", async () => {
    handlers.set("/api/chunked", (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("z".repeat(800));
      setImmediate(() => response.end("z".repeat(800)));
    });
    const forwarded = await forward(endpoint(), get("/chunked"), {
      ...limits,
      lookup: loopbackLookup([]),
    });
    await expect(new Response(forwarded.body).text()).rejects.toThrow();
    await expect(forwarded.done).resolves.toMatchObject({ capHit: "bytes" });
  });

  it("times out before the status line with an UpstreamError", async () => {
    handlers.set("/api/silent", () => undefined);
    let fire: () => void = () => undefined;
    const schedule: Schedule = (callback) => {
      fire = callback;
      return () => undefined;
    };
    const pending = forward(endpoint(), get("/silent"), {
      ...limits,
      schedule,
      lookup: loopbackLookup([]),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fire();
    expect(await failure(pending)).toBe("timeout");
  });

  it("breaks off a body still streaming at the deadline, and says which cap", async () => {
    handlers.set("/api/trickle", (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("first chunk");
    });
    let fire: () => void = () => undefined;
    const schedule: Schedule = (callback) => {
      fire = callback;
      return () => undefined;
    };
    const forwarded = await forward(endpoint(), get("/trickle"), {
      ...limits,
      schedule,
      lookup: loopbackLookup([]),
    });
    const text = new Response(forwarded.body).text();
    fire();
    await expect(text).rejects.toThrow();
    await expect(forwarded.done).resolves.toMatchObject({ capHit: "duration" });
  });

  it("follows a redirect under the base, through the lookup again", async () => {
    handlers.set("/api/processes", (_request, response) => {
      response.writeHead(301, { Location: "/api/processes/" }).end();
    });
    handlers.set("/api/processes/", (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
    const asked: string[] = [];
    const forwarded = await forward(endpoint(), get("/processes"), {
      ...limits,
      lookup: loopbackLookup(asked),
    });
    await new Response(forwarded.body).text();
    expect(forwarded.status).toBe(200);
    expect(forwarded.redirectsFollowed).toBe(1);
    expect(forwarded.finalUrl).toBe(`${base()}/processes/`);
    expect(asked).toEqual([HOST, HOST]);
  });

  it("refuses a redirect hop the address guard refuses", async () => {
    handlers.set("/api/hop", (_request, response) => {
      response.writeHead(302, { Location: `${base()}/landed` }).end();
    });
    handlers.set("/api/landed", (_request, response) => {
      response.writeHead(200).end("should not be reached");
    });
    const asked: string[] = [];
    const reason = await failure(
      forward(endpoint(), get("/hop"), { ...limits, lookup: loopbackLookup(asked, 2) }),
    );
    expect(reason).toBe("blocked-address");
    expect(asked).toEqual([HOST, HOST]);
    expect(seen.at(-1)?.url).toBe("/api/hop");
  });

  it("refuses a redirect off the base as its own failure, and does not follow it", async () => {
    // Handed back, the page's fetch would follow it or fail, and either way
    // the relay would look unreachable when it was the server that redirected.
    handlers.set("/api/away", (_request, response) => {
      response.writeHead(302, { Location: "http://evil.example/steal" }).end();
    });
    const asked: string[] = [];
    const reason = await failure(
      forward(endpoint(), get("/away"), { ...limits, lookup: loopbackLookup(asked) }),
    );
    expect(reason).toBe("redirect-refused");
    expect(asked).toEqual([HOST]);
  });

  it(`stops after ${String(MAX_REDIRECTS)} redirects, and says how many it followed`, async () => {
    handlers.set("/api/loop", (_request, response) => {
      response.writeHead(307, { Location: "/api/loop" }).end();
    });
    const asked: string[] = [];
    const error: unknown = await forward(endpoint(), get("/loop"), {
      ...limits,
      lookup: loopbackLookup(asked),
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ reason: "redirect-limit", redirectsFollowed: MAX_REDIRECTS });
    expect(asked).toHaveLength(MAX_REDIRECTS + 1);
  });

  it.each(["DELETE", "POST"] as const)(
    "refuses a redirect for a %s, and does not follow it",
    async (method) => {
      handlers.set("/api/jobs/9", (_request, response) => {
        response.writeHead(307, { Location: "/api/jobs/10" }).end();
      });
      const reason = await failure(
        forward(
          endpoint(),
          { method, url: new URL(`${base()}/jobs/9`), headers: new Headers(), body: "{}" },
          { ...limits, lookup: loopbackLookup([]) },
        ),
      );
      expect(reason).toBe("redirect-refused");
      expect(seen.at(-1)?.method).toBe(method);
      expect(seen.some((request) => request.url === "/api/jobs/10")).toBe(false);
    },
  );

  it("refuses a blocked host literal without connecting", async () => {
    const asked: string[] = [];
    const reason = await failure(
      forward(
        { ...endpoint(), baseUrl: "http://169.254.169.254/api" },
        { method: "GET", url: new URL("http://169.254.169.254/api/x"), headers: new Headers() },
        { ...limits, lookup: loopbackLookup(asked) },
      ),
    );
    expect(reason).toBe("blocked-address");
    expect(asked).toEqual([]);
  });

  it("uses the guarded lookup by default, which refuses a name resolving to a private address", async () => {
    const resolve: Resolver = (_hostname, _options, callback) => {
      callback(null, [{ address: "10.0.0.5", family: 4 }]);
    };
    const reason = await failure(forward(endpoint(), get("/processes"), { ...limits, resolve }));
    expect(reason).toBe("blocked-address");
  });
});
