/**
 * The read route's wrapper: which URLs it carries, how it says whose answer a
 * response is, and that the core cannot tell it from a well-behaved server.
 */

import { createClient, TransportError } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import type { RelayClient } from "../../src/relay/relay-client.js";
import {
  createRelayFetch,
  fromRelay,
  isUnder,
  relativeTo,
  relayRouteErrorIn,
  RelayRouteError,
} from "../../src/relay/relay-fetch.js";
import type { SessionSource } from "../../src/relay/routed-fetch.js";

const BASE = "http://localhost:5090/ogc-api";

interface Forwarded {
  readonly path: string;
  readonly method: string;
  readonly headers: Headers;
}

/** A relay whose `forward` answers from a queue, and records what it was asked. */
function fakeRelay(answers: (Response | Error)[]): RelayClient & { forwarded: Forwarded[] } {
  const forwarded: Forwarded[] = [];
  return {
    forwarded,
    baseUrl: "http://relay.test",
    endpoints: () => Promise.resolve([]),
    createSession: () => Promise.reject(new Error("not used")),
    openEvents: () => Promise.reject(new Error("not used")),
    execute: () => Promise.reject(new Error("not used")),
    forward: (path, init) => {
      forwarded.push({ path, method: init.method ?? "GET", headers: new Headers(init.headers) });
      const answer = answers.shift() ?? new Error("no more answers");
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

function sessions(tokens: (string | undefined)[]): SessionSource & { renewals: number } {
  let current = tokens.shift();
  const source = {
    renewals: 0,
    current: () => current,
    renew: () => {
      source.renewals += 1;
      current = tokens.shift();
      return Promise.resolve(current);
    },
  };
  return source;
}

/** What the relay sends for a forwarded answer. */
function forwarded(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", "X-Relay": "1", ...headers },
  });
}

function relayFetch(relay: RelayClient, session = sessions(["t1"])) {
  return createRelayFetch({ relay, endpointKey: "zoo", baseUrl: BASE, session });
}

async function thrown(promise: Promise<unknown>): Promise<RelayRouteError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RelayRouteError) return error;
    throw error;
  }
  throw new Error("expected a RelayRouteError");
}

describe("isUnder and relativeTo", () => {
  it("compares origin and a segment-bounded path prefix", () => {
    expect(isUnder(new URL(`${BASE}/processes`), BASE)).toBe(true);
    expect(isUnder(new URL(BASE), BASE)).toBe(true);
    expect(isUnder(new URL("http://localhost:5090/ogc-api-evil/x"), BASE)).toBe(false);
    expect(isUnder(new URL("http://localhost:5091/ogc-api/x"), BASE)).toBe(false);
    expect(isUnder(new URL("http://evil.example/ogc-api/x"), BASE)).toBe(false);
  });

  it("keeps the query and tells the base apart from the base with a slash", () => {
    expect(relativeTo(new URL(`${BASE}/jobs?limit=2&f=json`), BASE)).toBe("/jobs?limit=2&f=json");
    expect(relativeTo(new URL(BASE), BASE)).toBe("");
    expect(relativeTo(new URL(`${BASE}/`), BASE)).toBe("/");
  });
});

describe("createRelayFetch", () => {
  it("rewrites a URL under the base onto the read route, with the session", async () => {
    const relay = fakeRelay([forwarded("{}")]);
    await relayFetch(relay)(`${BASE}/processes?limit=5`, {
      headers: { Accept: "application/json", Authorization: "Bearer page-supplied" },
    });
    expect(relay.forwarded).toHaveLength(1);
    const [call] = relay.forwarded;
    expect(call?.path).toBe("/read/zoo/processes?limit=5");
    expect(call?.method).toBe("GET");
    expect(call?.headers.get("Accept")).toBe("application/json");
    // The relay's session, never whatever the caller put there.
    expect(call?.headers.get("Authorization")).toBe("Bearer t1");
  });

  it("carries DELETE for dismissal", async () => {
    const relay = fakeRelay([forwarded("{}")]);
    await relayFetch(relay)(`${BASE}/jobs/42`, { method: "DELETE" });
    expect(relay.forwarded.map((call) => [call.method, call.path])).toEqual([
      ["DELETE", "/read/zoo/jobs/42"],
    ]);
  });

  it("refuses a URL outside the base, and sends nothing", async () => {
    const relay = fakeRelay([]);
    const error = await thrown(relayFetch(relay)("http://evil.example/steal"));
    expect([error.outcome, error.code]).toEqual(["relay-refused", "outside-base"]);
    expect(relay.forwarded).toEqual([]);
  });

  it("refuses an execute, which goes through routed-fetch, and sends nothing", async () => {
    const relay = fakeRelay([]);
    const error = await thrown(
      relayFetch(relay)(`${BASE}/processes/echo/execution`, { method: "POST", body: "{}" }),
    );
    expect(error.code).toBe("method-not-carried");
    expect(relay.forwarded).toEqual([]);
  });

  it("hands the server's own 404 through as the server's", async () => {
    const relay = fakeRelay([forwarded('{"title":"Not Found"}', 404)]);
    const response = await relayFetch(relay)(`${BASE}/processes/nope`);
    expect(response.status).toBe(404);
    // Rebuilt, so the core resolves against the URL it asked for, not the relay's.
    expect(response.url).toBe("");
  });

  it("turns the relay's own refusal into an error, never a response", async () => {
    const relay = fakeRelay([
      forwarded("{}", 403, {
        "Content-Type": "application/problem+json",
        "X-Relay-Error": "read-route-off",
      }),
    ]);
    const error = await thrown(relayFetch(relay)(`${BASE}/processes`));
    expect([error.outcome, error.code, error.status]).toEqual([
      "relay-refused",
      "read-route-off",
      403,
    ]);
  });

  it("turns the relay's own 502 into upstream-failed, with its reason", async () => {
    const relay = fakeRelay([forwarded("{}", 502, { "X-Relay-Error": "connection-failed" })]);
    const error = await thrown(relayFetch(relay)(`${BASE}/processes`));
    expect([error.outcome, error.code]).toEqual(["upstream-failed", "connection-failed"]);
  });

  it("reads a response without the relay's marker as the relay being unreachable", async () => {
    // What a reverse proxy in front of a relay that is down answers.
    const gateway = new Response("<html>Bad Gateway</html>", { status: 502 });
    const error = await thrown(relayFetch(fakeRelay([gateway]))(`${BASE}/processes`));
    expect([error.outcome, error.code, error.status]).toEqual([
      "relay-unreachable",
      "no-relay-marker",
      502,
    ]);
  });

  it("reads a rejected request as the relay being unreachable", async () => {
    const error = await thrown(
      relayFetch(fakeRelay([new TypeError("Failed to fetch")]))(`${BASE}/processes`),
    );
    expect([error.outcome, error.code]).toEqual(["relay-unreachable", "unreachable"]);
  });

  it("asks again once on a new session after the relay forgot the old one", async () => {
    const relay = fakeRelay([
      forwarded("{}", 401, { "X-Relay-Error": "unknown-session" }),
      forwarded("{}"),
    ]);
    const session = sessions(["old", "new"]);
    const response = await relayFetch(relay, session)(`${BASE}/processes`);
    expect(response.status).toBe(200);
    expect(session.renewals).toBe(1);
    expect(relay.forwarded.map((call) => call.headers.get("Authorization"))).toEqual([
      "Bearer old",
      "Bearer new",
    ]);
  });

  it("fetches a session first when there is none yet", async () => {
    const relay = fakeRelay([forwarded("{}")]);
    const session = sessions([undefined, "fresh"]);
    await relayFetch(relay, session)(`${BASE}/`);
    expect(relay.forwarded[0]?.headers.get("Authorization")).toBe("Bearer fresh");
  });
});

describe("fromRelay", () => {
  it("passes a null-body status without a body", () => {
    const response = fromRelay(new Response(null, { status: 204, headers: { "X-Relay": "1" } }));
    expect(response.status).toBe(204);
  });
});

describe("through the core", () => {
  it("looks to the core like a server with perfect CORS headers", async () => {
    const landing = {
      links: [
        { rel: "self", href: `${BASE}/`, type: "application/json" },
        { rel: "http://www.opengis.net/def/rel/ogc/1.0/conformance", href: `${BASE}/conformance` },
      ],
    };
    const relay = fakeRelay([
      forwarded(JSON.stringify(landing)),
      forwarded(JSON.stringify({ conformsTo: [] })),
    ]);
    const client = createClient({ baseUrl: BASE, fetch: relayFetch(relay) });
    const service = await client.inspect();
    expect(service.url).toContain("localhost:5090/ogc-api");
    expect(relay.forwarded.map((call) => call.path)).toEqual([
      "/read/zoo/",
      "/read/zoo/conformance",
    ]);
  });

  it("surfaces a relay failure as a transport failure that still carries the relay's reason", async () => {
    const relay = fakeRelay([forwarded("{}", 502, { "X-Relay-Error": "timeout" })]);
    const client = createClient({ baseUrl: BASE, fetch: relayFetch(relay) });
    const error: unknown = await client.inspect().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TransportError);
    expect(relayRouteErrorIn(error)?.code).toBe("timeout");
  });
});
