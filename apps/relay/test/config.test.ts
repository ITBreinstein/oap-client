import { describe, expect, it } from "vitest";
import { ConfigError, MAX_TIMER_MS, parseConfig } from "../src/config.js";

const endpoint = { key: "pygeoapi", baseUrl: "https://ogc.example.org" };

describe("parseConfig", () => {
  it("defaults to direct, no callbacks, no private network", () => {
    const config = parseConfig({ endpoints: [endpoint] });
    expect(config.endpoints).toEqual([
      {
        key: "pygeoapi",
        baseUrl: "https://ogc.example.org",
        executeRoute: "direct",
        readRoute: "direct",
        callbacks: false,
        allowPrivateNetwork: false,
      },
    ]);
  });

  it("strips a trailing slash from the base", () => {
    const config = parseConfig({
      endpoints: [{ ...endpoint, baseUrl: "https://h.example/ogc-api/" }],
    });
    expect(config.endpoints[0]?.baseUrl).toBe("https://h.example/ogc-api");
  });

  it.each([
    ["credentials", "https://user:pass@h.example"],
    ["a username alone", "https://user@h.example"],
    ["a query", "https://h.example/?token=1"],
    ["a fragment", "https://h.example/#x"],
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

  it("accepts the read route only on an endpoint whose executes take the relay too", () => {
    expect(
      parseConfig({ endpoints: [{ ...endpoint, executeRoute: "relay", readRoute: "relay" }] })
        .endpoints[0]?.readRoute,
    ).toBe("relay");
    expect(() =>
      parseConfig({ endpoints: [{ ...endpoint, executeRoute: "direct", readRoute: "relay" }] }),
    ).toThrow(/readRoute/);
    expect(() => parseConfig({ endpoints: [{ ...endpoint, readRoute: "relay" }] })).toThrow(
      /readRoute/,
    );
    expect(() =>
      parseConfig({ endpoints: [{ ...endpoint, executeRoute: "relay", readRoute: "proxy" }] }),
    ).toThrow(/readRoute/);
  });

  it("caps the read route at 50 MB and 120 s unless told otherwise", () => {
    const { limits } = parseConfig({ endpoints: [] });
    expect(limits.maxReadResponseBytes).toBe(50 * 1024 * 1024);
    expect(limits.readTimeoutMs).toBe(120_000);
    const set = parseConfig({
      endpoints: [],
      limits: { maxReadResponseBytes: 1_000, readTimeoutMs: 5_000 },
    }).limits;
    expect([set.maxReadResponseBytes, set.readTimeoutMs]).toEqual([1_000, 5_000]);
    expect(() => parseConfig({ endpoints: [], limits: { readTimeoutMs: 0 } })).toThrow(/limits/);
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

  it("refuses a timeout longer than Node's timers hold, which would fire at once", () => {
    for (const key of ["readTimeoutMs", "upstreamTimeoutMs"]) {
      expect(() => parseConfig({ endpoints: [], limits: { [key]: MAX_TIMER_MS + 1 } })).toThrow(
        new RegExp(`limits\\.${key} must be at most`),
      );
      expect(parseConfig({ endpoints: [], limits: { [key]: MAX_TIMER_MS } }).limits).toMatchObject({
        [key]: MAX_TIMER_MS,
      });
    }
  });

  it.each([
    ["the root", { endpoints: [], rateLimit: {} }, /relay config: rateLimit is not a known member/],
    [
      "an endpoint",
      { endpoints: [{ ...endpoint, readroute: "relay" }] },
      /endpoints\[0\]\.readroute is not a known member/,
    ],
    [
      "limits",
      { endpoints: [], limits: { maxSession: 5 } },
      /limits\.maxSession is not a known member/,
    ],
  ])(
    "refuses an unknown member in %s, rather than running on the defaults",
    (_, input, message) => {
      expect(() => parseConfig(input)).toThrow(message);
    },
  );

  it("trusts no proxy unless told, and takes addresses and ranges in private space", () => {
    expect(parseConfig({ endpoints: [] }).trustedProxies).toEqual([]);
    const { trustedProxies } = parseConfig({
      endpoints: [],
      trustedProxies: ["172.31.87.1", "::ffff:127.0.0.1", "192.168.0.0/16", "fd00::/8"],
    });
    expect(trustedProxies.map((proxy) => [proxy.family, proxy.prefix])).toEqual([
      [4, 32],
      [4, 32],
      [4, 16],
      [6, 8],
    ]);
  });

  it.each([
    ["everyone, IPv4", "0.0.0.0/0", /must be a loopback or private/],
    ["everyone, IPv6", "::/0", /must be a loopback or private/],
    ["a public address", "8.8.8.8", /must be a loopback or private/],
    ["a range wider than private space", "172.0.0.0/8", /must be a loopback or private/],
    ["link-local", "169.254.169.254", /must be a loopback or private/],
    ["a name", "caddy", /is not an IP address/],
    ["a bad prefix", "10.0.0.0/33", /is not an IP address/],
  ])("refuses to trust %s", (_, entry, message) => {
    expect(() => parseConfig({ endpoints: [], trustedProxies: [entry] })).toThrow(message);
  });

  it("refuses trustedProxies that is not an array of strings", () => {
    expect(() => parseConfig({ endpoints: [], trustedProxies: "172.17.0.1" })).toThrow(
      /trustedProxies must be an array/,
    );
    expect(() => parseConfig({ endpoints: [], trustedProxies: [172] })).toThrow(
      /trustedProxies\[0\] must be a string/,
    );
  });

  it("rate-limits with the production values unless told otherwise", () => {
    expect(parseConfig({ endpoints: [] }).rateLimits).toEqual({
      perClient: {
        sessionsPerMinute: 10,
        executesPerMinute: 20,
        readsPerMinute: 240,
        endpointsAndPreflightsPerMinute: 120,
        openStreams: 4,
        inFlight: 6,
      },
      perEndpoint: { requestsPerMinute: 600, inFlight: 32 },
      maxTrackedClients: 50_000,
    });
  });

  it("takes each rate limit from the file, keeping the defaults for the rest", () => {
    const { rateLimits } = parseConfig({
      endpoints: [],
      rateLimits: {
        perClient: { sessionsPerMinute: 100 },
        perEndpoint: { inFlight: 64 },
        maxTrackedClients: 1_000,
      },
    });
    expect(rateLimits.perClient.sessionsPerMinute).toBe(100);
    expect(rateLimits.perClient.readsPerMinute).toBe(240);
    expect(rateLimits.perEndpoint).toEqual({ requestsPerMinute: 600, inFlight: 64 });
    expect(rateLimits.maxTrackedClients).toBe(1_000);
  });

  it.each([
    ["zero", { perClient: { sessionsPerMinute: 0 } }, /rateLimits\.perClient\.sessionsPerMinute/],
    ["a fraction", { perEndpoint: { inFlight: 1.5 } }, /rateLimits\.perEndpoint\.inFlight/],
    ["a string", { maxTrackedClients: "50000" }, /rateLimits\.maxTrackedClients/],
    ["an unknown member", { perClient: { reads: 1 } }, /rateLimits\.perClient\.reads is not/],
    ["an unknown section", { perSession: {} }, /rateLimits\.perSession is not/],
    ["a switch to turn them off", { enabled: false }, /rateLimits\.enabled is not/],
    ["not an object", [], /rateLimits must be an object/],
  ])("refuses rate limits with %s", (_, rateLimits, message) => {
    expect(() => parseConfig({ endpoints: [], rateLimits })).toThrow(message);
  });
});
