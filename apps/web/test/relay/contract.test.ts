// @vitest-environment node
/**
 * The relay's wire contract as the browser reads it: what each parser takes,
 * and that anything else is a `RelayContractError` rather than a value of the
 * wrong shape (review T12). The relay is ours, but it is still a network peer:
 * a refusal here is what keeps `undefined` out of a job panel.
 */

import { describe, expect, it } from "vitest";
import {
  parseDoorbell,
  parseEndpoints,
  parseRelayedExecute,
  parseSessionGrant,
  readRefusalReason,
  RelayContractError,
} from "../../src/relay/contract.js";

const endpoint = {
  key: "pygeoapi",
  baseUrl: "http://localhost:5080/",
  executeRoute: "relay",
  readRoute: "relay",
  callbacks: true,
};

describe("parseEndpoints", () => {
  it("reads each endpoint", () => {
    expect(parseEndpoints({ endpoints: [endpoint] })).toEqual([endpoint]);
    expect(parseEndpoints({ endpoints: [] })).toEqual([]);
  });

  it("reads a relay from before the read route as offering none", () => {
    const older = {
      key: endpoint.key,
      baseUrl: endpoint.baseUrl,
      executeRoute: endpoint.executeRoute,
      callbacks: endpoint.callbacks,
    };
    expect(parseEndpoints({ endpoints: [older] })).toEqual([{ ...older, readRoute: "direct" }]);
  });

  it.each([
    ["not an object", "endpoints"],
    ["no list", {}],
    ["a list that is not one", { endpoints: "pygeoapi" }],
    ["an entry that is not an object", { endpoints: [null] }],
    ["a key that is not a string", { endpoints: [{ ...endpoint, key: 1 }] }],
    ["a base URL that is not a string", { endpoints: [{ ...endpoint, baseUrl: undefined }] }],
    ["an execute route it does not know", { endpoints: [{ ...endpoint, executeRoute: "both" }] }],
    ["a read route it does not know", { endpoints: [{ ...endpoint, readRoute: "both" }] }],
    ["callbacks that are not a boolean", { endpoints: [{ ...endpoint, callbacks: "yes" }] }],
  ])("refuses %s", (_case, value) => {
    expect(() => parseEndpoints(value)).toThrow(RelayContractError);
  });
});

describe("parseSessionGrant", () => {
  it("reads a token and its expiry", () => {
    expect(parseSessionGrant({ token: "t", expiresAt: 1_700_000_000_000 })).toEqual({
      token: "t",
      expiresAt: 1_700_000_000_000,
    });
  });

  it.each([
    ["not an object", null],
    ["no token", { expiresAt: 1 }],
    ["an expiry that is not a number", { token: "t", expiresAt: "soon" }],
  ])("refuses %s", (_case, value) => {
    expect(() => parseSessionGrant(value)).toThrow("relay sent a malformed session grant");
  });
});

describe("parseRelayedExecute", () => {
  const upstream = { status: 201, body: '{"jobID":"j1"}', location: "http://x/jobs/j1" };

  it("reads the server's answer and the job's registration", () => {
    expect(parseRelayedExecute({ upstream, registration: { ref: "r1" } })).toEqual({
      upstream: {
        status: 201,
        body: '{"jobID":"j1"}',
        location: "http://x/jobs/j1",
        contentType: undefined,
        preferenceApplied: undefined,
      },
      ref: "r1",
    });
  });

  it("reads no registration as no ref", () => {
    expect(parseRelayedExecute({ upstream, registration: null }).ref).toBeUndefined();
  });

  it.each([
    ["not an object", "upstream"],
    ["no upstream", { registration: null }],
    ["a status that is not a whole number", { upstream: { ...upstream, status: 201.5 } }],
    ["a body that is not text", { upstream: { ...upstream, body: { jobID: "j1" } } }],
    ["a location that is not text", { upstream: { ...upstream, location: 7 }, registration: null }],
    ["a registration with no ref", { upstream, registration: {} }],
    ["a registration missing altogether", { upstream }],
  ])("refuses %s", (_case, value) => {
    expect(() => parseRelayedExecute(value)).toThrow(RelayContractError);
  });
});

describe("parseDoorbell", () => {
  it("reads the ref and the callbacks it knows, in its own order", () => {
    expect(parseDoorbell('{"ref":"r1","callbacks":["failed","bogus","success"]}')).toEqual({
      ref: "r1",
      callbacks: ["success", "failed"],
    });
  });

  it.each([
    ["not JSON", "{"],
    ["no ref", "{}"],
    ["an empty ref", '{"ref":""}'],
    ["a list", "[]"],
  ])("is no doorbell for %s, and never throws", (_case, data) => {
    expect(parseDoorbell(data)).toBeUndefined();
  });
});

describe("readRefusalReason", () => {
  it("reads `reason`, then `detail`", () => {
    expect(readRefusalReason({ reason: "outside-base", detail: "no" })).toBe("outside-base");
    expect(readRefusalReason({ detail: "unknown endpoint" })).toBe("unknown endpoint");
  });

  it.each([
    ["not an object", "nope"],
    ["neither", {}],
    ["a reason that is not text", { reason: 3 }],
  ])("is undefined for %s", (_case, value) => {
    expect(readRefusalReason(value)).toBeUndefined();
  });
});
