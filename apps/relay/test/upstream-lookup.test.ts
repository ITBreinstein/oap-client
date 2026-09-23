/**
 * That `postExecute` really connects through the guarded lookup.
 *
 * No msw here: msw answers above the socket, so under it the lookup never
 * runs. Instead the resolver is injected and answers with a private address,
 * which the guard refuses before any connection is attempted — so this still
 * touches no network.
 */

import { describe, expect, it } from "vitest";
import type { EndpointConfig } from "../src/config.js";
import type { Resolver } from "../src/address-guard.js";
import { postExecute, UpstreamError } from "../src/upstream.js";

describe("postExecute's connect-time address check", () => {
  it("refuses an allowlisted name that resolves to a private address", async () => {
    const asked: string[] = [];
    const resolve: Resolver = (hostname, _options, callback) => {
      asked.push(hostname);
      callback(null, [{ address: "10.0.0.5", family: 4 }]);
    };
    const endpoint: EndpointConfig = {
      key: "rebound",
      baseUrl: "http://ogc.rebind.test",
      executeRoute: "relay",
      callbacks: false,
      allowPrivateNetwork: false,
    };

    const outcome = await postExecute(endpoint, "p", "{}", {
      timeoutMs: 5_000,
      maxResponseBytes: 1_024,
      resolve,
    }).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(UpstreamError);
    expect(outcome instanceof UpstreamError ? outcome.reason : undefined).toBe("blocked-address");
    expect(asked).toEqual(["ogc.rebind.test"]);
  });
});
