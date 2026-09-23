import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";

const endpoint = { key: "pygeoapi", baseUrl: "http://localhost:5080" };

describe("parseConfig", () => {
  it("defaults to direct, no callbacks, no private network", () => {
    const config = parseConfig({ endpoints: [endpoint] });
    expect(config.endpoints).toEqual([
      {
        key: "pygeoapi",
        baseUrl: "http://localhost:5080",
        executeRoute: "direct",
        callbacks: false,
        allowPrivateNetwork: false,
      },
    ]);
  });

  it("strips a trailing slash from the base", () => {
    const config = parseConfig({ endpoints: [{ ...endpoint, baseUrl: "http://h/ogc-api/" }] });
    expect(config.endpoints[0]?.baseUrl).toBe("http://h/ogc-api");
  });

  it.each([
    ["credentials", "http://user:pass@h"],
    ["a username alone", "http://user@h"],
    ["a query", "http://h/?token=1"],
    ["a fragment", "http://h/#x"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["garbage", "not a url"],
  ])("rejects a base URL with %s", (_, baseUrl) => {
    expect(() => parseConfig({ endpoints: [{ ...endpoint, baseUrl }] })).toThrow(ConfigError);
  });

  it("requires publicUrl once any endpoint has callbacks", () => {
    expect(() => parseConfig({ endpoints: [{ ...endpoint, callbacks: true }] })).toThrow(
      /publicUrl/,
    );
    expect(
      parseConfig({ publicUrl: "http://relay:8787", endpoints: [{ ...endpoint, callbacks: true }] })
        .publicUrl,
    ).toBe("http://relay:8787");
  });

  it("rejects a repeated key and an unsafe one", () => {
    expect(() => parseConfig({ endpoints: [endpoint, endpoint] })).toThrow(/repeat/);
    expect(() => parseConfig({ endpoints: [{ ...endpoint, key: "../x" }] })).toThrow(/key/);
  });

  it("rejects an execute route that is neither direct nor relay", () => {
    expect(() => parseConfig({ endpoints: [{ ...endpoint, executeRoute: "fallback" }] })).toThrow(
      /executeRoute/,
    );
  });

  it("accepts only exact origins", () => {
    expect(
      parseConfig({ endpoints: [], allowedOrigins: ["http://localhost:4173"] }).allowedOrigins,
    ).toEqual(["http://localhost:4173"]);
    expect(() =>
      parseConfig({ endpoints: [], allowedOrigins: ["http://localhost:4173/"] }),
    ).toThrow();
    expect(() => parseConfig({ endpoints: [], allowedOrigins: ["*"] })).toThrow();
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => parseConfig({ endpoints: [], limits: { upstreamTimeoutMs: -1 } })).toThrow(
      /limits/,
    );
    expect(() => parseConfig({ endpoints: [], limits: { maxSessions: 1.5 } })).toThrow(/limits/);
  });
});
