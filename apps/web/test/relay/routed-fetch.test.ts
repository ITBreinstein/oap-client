// @vitest-environment node
/**
 * Route B through the real core: `execute()` is handed the routed fetch and
 * must end up with a job it can name, discovered by `Location`, exactly as it
 * would from Node. Nothing here reaches a network — the relay and the direct
 * route are both functions.
 */

import { execute, type FetchLike } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import type { RelayedExecute, RelayEndpoint } from "../../src/relay/contract.js";
import { RelayError, type RelayClient } from "../../src/relay/relay-client.js";
import {
  createRoutedFetch,
  type ExecuteRouteObservation,
  type SessionSource,
} from "../../src/relay/routed-fetch.js";

const BASE = "http://ogc.test";
const RELAYED: RelayEndpoint = {
  key: "ogc",
  baseUrl: BASE,
  executeRoute: "relay",
  callbacks: true,
};
const DIRECT: RelayEndpoint = { ...RELAYED, executeRoute: "direct" };

const CREATED: RelayedExecute = {
  upstream: {
    status: 201,
    location: "/jobs/42",
    contentType: "application/json",
    preferenceApplied: "respond-async",
    body: "null",
  },
  ref: "ref-42",
};

interface RelayCall {
  endpointKey: string;
  processId: string;
  body: string;
  session: string | undefined;
}

function fakeRelay(answers: (RelayedExecute | Error)[]): RelayClient & { calls: RelayCall[] } {
  const calls: RelayCall[] = [];
  return {
    calls,
    baseUrl: "http://relay.test",
    endpoints: () => Promise.resolve([]),
    createSession: () => Promise.resolve({ token: "s", expiresAt: 0 }),
    openEvents: () => Promise.reject(new Error("not used")),
    execute: (endpointKey, processId, body, session) => {
      calls.push({ endpointKey, processId, body, session });
      const answer = answers.shift() ?? new Error("no more answers");
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

function directFetch() {
  const calls: string[] = [];
  const impl: FetchLike = (input) => {
    calls.push(input);
    return Promise.resolve(
      new Response('{"id":"x","value":1}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { impl, calls };
}

function sessions(tokens: string[]): SessionSource & { renewals: number } {
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

describe("createRoutedFetch", () => {
  it("sends an async execute through the relay, and the core names the job by Location", async () => {
    const relay = fakeRelay([CREATED]);
    const direct = directFetch();
    const routes: ExecuteRouteObservation[] = [];
    const registrations: [string, string | undefined][] = [];
    const routed = createRoutedFetch({
      endpoint: RELAYED,
      relay,
      session: sessions(["session-1"]),
      fetch: direct.impl,
      onRoute: (observation) => routes.push(observation),
      onRegistration: (ref, statusUrl) => registrations.push([ref, statusUrl]),
    });

    const execution = await execute(`${BASE}/processes`, "slow", {
      inputs: { seconds: 1 },
      mode: "async",
      fetch: routed,
    });

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") return;
    expect(execution.job.statusUrl).toBe("http://ogc.test/jobs/42");
    expect(execution.job.discoveredVia).toBe("location-header");
    // The ref maps to exactly the URL the core resolved.
    expect(registrations).toEqual([["ref-42", execution.job.statusUrl]]);
    expect(direct.calls).toEqual([]);
    expect(relay.calls).toEqual([
      {
        endpointKey: "ogc",
        processId: "slow",
        body: '{"inputs":{"seconds":1}}',
        session: "session-1",
      },
    ]);
    expect(routes).toEqual([
      {
        kind: "execute-route",
        endpointKey: "ogc",
        route: "relay",
        requestedMode: "async",
        outcome: "sent",
        locationPresent: true,
        callbacksRegistered: true,
        queryDropped: false,
        reason: undefined,
      },
    ]);
  });

  it("records that a pygeoapi-style ?f=json execute link lost its query on the relay route", async () => {
    const routes: ExecuteRouteObservation[] = [];
    const routed = createRoutedFetch({
      endpoint: RELAYED,
      relay: fakeRelay([CREATED]),
      onRoute: (observation) => routes.push(observation),
    });
    await routed(`${BASE}/processes/slow/execution?f=json`, {
      method: "POST",
      headers: { Prefer: "respond-async" },
      body: "{}",
    });
    expect(routes[0]?.queryDropped).toBe(true);
  });

  it("sends a synchronous execute straight to the server — it needs no Location", async () => {
    const relay = fakeRelay([]);
    const direct = directFetch();
    const routes: ExecuteRouteObservation[] = [];
    const routed = createRoutedFetch({
      endpoint: RELAYED,
      relay,
      fetch: direct.impl,
      onRoute: (observation) => routes.push(observation),
    });

    const execution = await execute(`${BASE}/processes`, "echo", { inputs: {}, fetch: routed });

    expect(execution.kind).toBe("immediate");
    expect(relay.calls).toEqual([]);
    expect(direct.calls).toEqual([`${BASE}/processes/echo/execution`]);
    expect(routes[0]).toMatchObject({ route: "direct", requestedMode: "sync", outcome: "sent" });
  });

  it("sends everything straight through for a direct-route endpoint, and without a relay", async () => {
    for (const [endpoint, relay] of [
      [DIRECT, fakeRelay([])],
      [RELAYED, undefined],
    ] as const) {
      const direct = directFetch();
      const routed = createRoutedFetch({ endpoint, relay, fetch: direct.impl });
      await routed(`${BASE}/processes/slow/execution`, {
        method: "POST",
        headers: { Prefer: "respond-async" },
        body: "{}",
      });
      expect(direct.calls).toHaveLength(1);
      expect(relay?.calls ?? []).toEqual([]);
    }
  });

  it("passes every other request straight through, untouched", async () => {
    const relay = fakeRelay([]);
    const direct = directFetch();
    const routed = createRoutedFetch({ endpoint: RELAYED, relay, fetch: direct.impl });
    await routed(`${BASE}/jobs/42`);
    await routed(`${BASE}/jobs/42`, { method: "DELETE" });
    await routed("http://elsewhere.test/processes/slow/execution", {
      method: "POST",
      headers: { Prefer: "respond-async" },
    });
    expect(direct.calls).toHaveLength(3);
    expect(relay.calls).toEqual([]);
  });

  it("never falls back to the direct route when the relay fails — a job may exist", async () => {
    const relay = fakeRelay([new RelayError(502, "timeout", false)]);
    const direct = directFetch();
    const routes: ExecuteRouteObservation[] = [];
    const routed = createRoutedFetch({
      endpoint: RELAYED,
      relay,
      fetch: direct.impl,
      onRoute: (observation) => routes.push(observation),
    });

    await expect(
      execute(`${BASE}/processes`, "slow", { inputs: {}, mode: "async", fetch: routed }),
    ).rejects.toThrow(/relay route failed: timeout/);

    expect(direct.calls).toEqual([]);
    expect(relay.calls).toHaveLength(1);
    expect(routes[0]).toMatchObject({ route: "relay", outcome: "relay-failed", reason: "timeout" });
  });

  it("after a relay restart, renews the session and retries once — nothing was sent upstream", async () => {
    const relay = fakeRelay([new RelayError(401, "unknown session", true), CREATED]);
    const source = sessions(["stale", "fresh"]);
    const routed = createRoutedFetch({ endpoint: RELAYED, relay, session: source });

    const execution = await execute(`${BASE}/processes`, "slow", {
      inputs: {},
      mode: "async",
      fetch: routed,
    });

    expect(execution.kind).toBe("job");
    expect(source.renewals).toBe(1);
    expect(relay.calls.map((call) => call.session)).toEqual(["stale", "fresh"]);
  });

  it("retries a 401 once only", async () => {
    const relay = fakeRelay([
      new RelayError(401, "unknown session", true),
      new RelayError(401, "unknown session", true),
    ]);
    const routed = createRoutedFetch({ endpoint: RELAYED, relay, session: sessions(["a", "b"]) });
    await expect(
      routed(`${BASE}/processes/slow/execution`, {
        method: "POST",
        headers: { Prefer: "respond-async" },
        body: "{}",
      }),
    ).rejects.toThrow(TypeError);
    expect(relay.calls).toHaveLength(2);
  });

  it("does not guess when the server sent no Location through the relay either", async () => {
    const relay = fakeRelay([
      { ...CREATED, upstream: { ...CREATED.upstream, location: undefined } },
    ]);
    const routed = createRoutedFetch({ endpoint: RELAYED, relay });
    // The core's own refusal to guess (finding 0039) survives the relay: a 201
    // with a null body and no Location is still ambiguous.
    await expect(
      execute(`${BASE}/processes`, "slow", { inputs: {}, mode: "async", fetch: routed }),
    ).rejects.toThrow(/ambiguous|could not find|Location/i);
  });
});
