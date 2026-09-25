/**
 * Direct first, then the click: the rules, without a browser. The reducer's
 * half — that nothing reaches the relay route without an open offer and a
 * confirmation — is in workflow.test.ts.
 */

import { TransportError } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import {
  accessRecord,
  directFailure,
  offersRelay,
  relayAttempt,
  type AttemptFacts,
} from "../../src/app/route-decision.js";
import type { EndpointRef } from "../../src/app/workflow.js";
import { RelayRouteError } from "../../src/relay/relay-fetch.js";

const readRoute: EndpointRef = {
  source: "configured",
  key: "zoo",
  baseUrl: "http://localhost:5090/ogc-api?token=secret",
  executeRoute: "relay",
  readRoute: "relay",
  callbacks: false,
};
const directOnly: EndpointRef = { ...readRoute, key: "pygeoapi-nocors", readRoute: "direct" };
const typed: EndpointRef = { source: "typed", baseUrl: "http://localhost:5081" };

const cors = new TransportError("failed", "http://localhost:5090/ogc-api", true);
const sameOrigin = new TransportError("failed", "http://localhost:5173/x", false);
const at = new Date("2026-09-25T12:00:00Z");

function facts(endpoint: EndpointRef, overrides: Partial<AttemptFacts> = {}): AttemptFacts {
  return {
    endpoint,
    at,
    relayAvailable: true,
    direct: "cors-blocked",
    directError: "TransportError",
    ...overrides,
  };
}

describe("directFailure", () => {
  it("calls a cross-origin request with no response CORS, and nothing else", () => {
    expect(directFailure(cors)).toBe("cors-blocked");
    expect(directFailure(sameOrigin)).toBe("failed");
    expect(directFailure(new Error("parse"))).toBe("failed");
  });
});

describe("offersRelay", () => {
  it.each<[string, EndpointRef, "cors-blocked" | "failed" | "connected", boolean, boolean]>([
    ["direct ok", readRoute, "connected", true, false],
    ["blocked, configured for the read route", readRoute, "cors-blocked", true, true],
    ["blocked, configured direct-only", directOnly, "cors-blocked", true, false],
    ["blocked, a typed address", typed, "cors-blocked", true, false],
    ["blocked, but no relay on this page", readRoute, "cors-blocked", false, false],
    ["failed some other way", readRoute, "failed", true, false],
  ])("%s → %s", (_, endpoint, direct, relayAvailable, expected) => {
    expect(offersRelay(endpoint, direct, relayAvailable)).toBe(expected);
  });
});

describe("relayAttempt", () => {
  it("reads the relay's own reason off the error, however deep the core wrapped it", () => {
    const wrapped = new TransportError("failed", "u", true, {
      cause: new RelayRouteError("upstream-failed", "timeout", 502),
    });
    expect(relayAttempt(wrapped)).toEqual({
      relayOutcome: "upstream-failed",
      relayReasonCode: "timeout",
    });
    expect(relayAttempt(new RelayRouteError("relay-unreachable", "no-relay-marker", 502))).toEqual({
      relayOutcome: "relay-unreachable",
      relayReasonCode: "no-relay-marker",
    });
  });

  it("calls anything else other-failure: the server's own answer came back", () => {
    expect(relayAttempt(new Error("not JSON"))).toEqual({
      relayOutcome: "other-failure",
      relayReasonCode: undefined,
    });
    expect(relayAttempt(undefined)).toEqual({ relayOutcome: "ok", relayReasonCode: undefined });
  });
});

describe("accessRecord", () => {
  it("records a direct connection, with the fallback configured but unused", () => {
    expect(accessRecord(facts(readRoute, { direct: "connected", directError: undefined }))).toEqual(
      {
        kind: "endpoint-access",
        endpoint: "http://localhost:5090/ogc-api",
        endpointKey: "zoo",
        source: "configured",
        at: "2026-09-25T12:00:00.000Z",
        outcome: "connected",
        error: undefined,
        relayConfigured: true,
        userConfirmedRelay: false,
        relayOutcome: undefined,
        relayReasonCode: undefined,
        routeUsed: "direct",
      },
    );
  });

  it("records blocked + not configured: no offer, no route", () => {
    expect(accessRecord(facts(directOnly))).toMatchObject({
      outcome: "cors-blocked",
      relayConfigured: false,
      userConfirmedRelay: false,
      relayOutcome: undefined,
      routeUsed: "none",
    });
  });

  it("records a decline: offered, not clicked, nothing sent", () => {
    expect(accessRecord(facts(readRoute, { confirmed: false }))).toMatchObject({
      outcome: "cors-blocked",
      relayConfigured: true,
      userConfirmedRelay: false,
      relayOutcome: undefined,
      routeUsed: "none",
    });
  });

  it("records blocked + confirmed + reached: the direct failure stays on the record", () => {
    expect(
      accessRecord(facts(readRoute, { confirmed: true, relay: relayAttempt(undefined) })),
    ).toMatchObject({
      outcome: "cors-blocked",
      userConfirmedRelay: true,
      relayOutcome: "ok",
      routeUsed: "relay",
    });
  });

  it("records confirmed but the relay failed: no route, and the relay's reason", () => {
    const attempt = relayAttempt(new RelayRouteError("upstream-failed", "connection-failed", 502));
    expect(accessRecord(facts(readRoute, { confirmed: true, relay: attempt }))).toMatchObject({
      userConfirmedRelay: true,
      relayOutcome: "upstream-failed",
      relayReasonCode: "connection-failed",
      routeUsed: "none",
    });
  });

  it("records other-failure as no route, though it proves the server was up", () => {
    const attempt = relayAttempt(new Error("unusable"));
    expect(accessRecord(facts(readRoute, { confirmed: true, relay: attempt }))).toMatchObject({
      relayOutcome: "other-failure",
      routeUsed: "none",
    });
  });

  it("records a typed address without a key", () => {
    expect(accessRecord(facts(typed))).toMatchObject({
      endpointKey: undefined,
      source: "typed",
      relayConfigured: false,
    });
  });
});
