import { TransportError } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { rateLimitMessage, runError } from "../../src/app/run.js";
import type { FormPlan } from "../../src/forms/plan.js";
import { RelayError } from "../../src/relay/relay-client.js";
import { RelayRouteError } from "../../src/relay/relay-fetch.js";

describe("rateLimitMessage", () => {
  it("says how long to wait, from Retry-After", () => {
    expect(rateLimitMessage(new RelayRouteError("relay-refused", "rate-limited", 429, 6))).toEqual({
      title: "Too many requests through the relay. Try again in 6 seconds.",
      detail:
        "This page, or others sharing its network address, sent more requests through the relay than it allows for now. (rate-limited)",
    });
  });

  it("says one second, not one seconds", () => {
    expect(
      rateLimitMessage(new RelayRouteError("relay-refused", "rate-limited", 429, 1))?.title,
    ).toBe("Too many requests through the relay. Try again in 1 second.");
  });

  it("names the service's ceiling apart from this page's own limit", () => {
    expect(
      rateLimitMessage(new RelayRouteError("relay-refused", "rate-limited-endpoint", 429, 60))
        ?.detail,
    ).toContain("(rate-limited-endpoint)");
  });

  it("does not invent a wait the relay did not send", () => {
    expect(rateLimitMessage(new RelayRouteError("relay-refused", "rate-limited", 429))?.title).toBe(
      "Too many requests through the relay. Try again shortly.",
    );
  });

  it("finds an execute's refusal however deep the execute route and the core wrapped it", () => {
    // routed-fetch throws a TypeError with the RelayError as its cause, and the
    // core's transport wraps that in turn.
    const refusal = new RelayError(429, "rate-limited", true, 12);
    const wrapped = new TransportError("failed", "http://ogc.test/processes/p/execution", true, {
      cause: new TypeError("relay route failed: rate-limited", { cause: refusal }),
    });
    expect(rateLimitMessage(wrapped)?.title).toBe(
      "Too many requests through the relay. Try again in 12 seconds.",
    );
  });

  it("is undefined for any other refusal or failure", () => {
    expect(rateLimitMessage(new RelayRouteError("relay-refused", "unknown-session", 401))).toBe(
      undefined,
    );
    expect(rateLimitMessage(new RelayError(429, "registration-capacity", true))).toBeUndefined();
    expect(rateLimitMessage(new Error("other"))).toBeUndefined();
  });
});

describe("runError", () => {
  it("puts the relay's rate limit before anything else", () => {
    const plan: FormPlan = { fields: [], diagnostics: [] };
    expect(runError(new RelayRouteError("relay-refused", "rate-limited", 429, 6), plan).title).toBe(
      "Too many requests through the relay. Try again in 6 seconds.",
    );
  });
});
