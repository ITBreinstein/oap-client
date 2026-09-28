/**
 * SSRF matrix A: the upstream URL, built from a path the browser influences.
 *
 * The relay never parses a URL the browser sent. It appends a path the browser
 * sent *relative* to the endpoint's base, refuses anything that could name
 * another origin, climb out of the base or smuggle a separator, and then
 * checks the parsed result: same origin, no userinfo, under the base path.
 *
 * A6 is decided: the resolved path must stay under the base path. That was
 * already the rule (ADR 0001); these tests pin it.
 *
 * "Refused" means an `X-Relay-Error` code and zero calls to the outbound
 * request, which is a counter here.
 */

import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { isUnderBase, resolveReadTarget } from "../../src/forward.js";
import { browserRequest, countingApp, ORIGIN, publicEndpoint } from "./fixtures.js";

const config = parseConfig({
  allowedOrigins: [ORIGIN],
  endpoints: [
    {
      key: "testbed",
      baseUrl: "https://testbed.example/ogc/",
      executeRoute: "relay",
      readRoute: "relay",
    },
  ],
});

const TESTBED = publicEndpoint("https://testbed.example/ogc");

describe("A — through the app: refused before anything is sent", () => {
  it.each([
    ["A1", "//evil.example/x", "absolute-url"],
    ["A2", "/http://169.254.169.254/latest", "absolute-url"],
    // The URL parser turns `\` into `/` before the relay sees the path, so
    // this arrives as `//evil.example/x`.
    ["A3", "/\\evil.example/x", "absolute-url"],
    // Refused, not forwarded: an encoded separator is never passed on, because
    // some servers decode it into a real one after our check.
    ["A4", "/%2F%2Fevil.example", "encoded-separator"],
    ["A5", "/https://testbed.example@evil.example/", "absolute-url"],
    ["A7", "/http://testbed.example/ogc/x", "absolute-url"],
  ])("%s: /read/testbed%s → %s", async (_id, path, code) => {
    const h = countingApp(config);
    const response = await browserRequest(h.app, `/read/testbed${path}`);
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Relay-Error")).toBe(code);
    expect(h.forwarded).toEqual([]);
  });

  it.each(["/../../admin", "/%2e%2e/%2e%2e/admin", "/.%2E/admin"])(
    "A6: /read/testbed%s is normalised off the route by the URL parser, and sends nothing",
    async (path) => {
      const h = countingApp(config);
      const response = await browserRequest(h.app, `/read/testbed${path}`);
      // `/admin` is no route; `/read/admin` is no endpoint. Either way, a 404.
      expect(response.status).toBe(404);
      expect(["not-found", "unknown-endpoint"]).toContain(response.headers.get("X-Relay-Error"));
      expect(h.forwarded).toEqual([]);
    },
  );

  it.each([
    ["an @ in the path", "/@evil.example/x", ""],
    ["a URL in the query", "/processes", "?next=http://169.254.169.254/latest"],
    ["a network-path reference in the query", "/processes", "?next=//evil.example"],
  ])("stays on the configured origin with %s", async (_label, path, search) => {
    const h = countingApp(config);
    const response = await browserRequest(h.app, `/read/testbed${path}${search}`);
    expect(response.headers.get("X-Relay-Error")).toBeNull();
    const [sent] = h.forwarded;
    expect(sent?.url.origin).toBe("https://testbed.example");
    expect(sent?.url.username).toBe("");
    expect(sent?.url.password).toBe("");
    expect(sent?.url.pathname.startsWith("/ogc/")).toBe(true);
    expect(sent?.url.search).toBe(search);
  });
});

describe("A — resolveReadTarget on raw input, which the relay must not assume was parsed", () => {
  it.each([
    ["A1", "//evil.example/x", "absolute-url"],
    ["A2", "http://169.254.169.254/latest", "absolute-url"],
    ["A3", "/\\evil.example/x", "encoded-separator"],
    ["A4", "/%2F%2Fevil.example", "encoded-separator"],
    ["A5", "https://testbed.example@evil.example/", "absolute-url"],
    ["A6", "/../../admin", "dot-segment"],
    ["A6", "/%2e%2e/admin", "dot-segment"],
    ["A6", "/processes/.%2E/.%2e/admin", "dot-segment"],
    ["A7", "http://testbed.example/ogc/x", "absolute-url"],
    ["A7", "/http:/testbed.example/ogc/x", "absolute-url"],
  ])("%s: %s → %s", (_id, path, code) => {
    expect(resolveReadTarget(TESTBED, path, "")).toBe(code);
  });
});

describe("A — the invariant, over hostile input", () => {
  const paths = [
    "",
    "/",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r\n/evil.example",
    "/ /evil.example",
    "/@evil.example",
    "/:@evil.example",
    "/evil.example:80@x",
    "/%40evil.example",
    "/%2e%2e",
    "/%252e%252e/x",
    "/..%2f",
    "/%5c%5cevil.example",
    "/http:evil.example",
    "/HTTP://evil.example",
    "/javascript:alert(1)",
    "/。evil.example",
    "/．．/admin",
    "/%00",
    "/%ff",
    "/processes/../../x",
  ];
  const searches = ["", "?a=b", "?@evil.example", "?//evil.example", "?\\evil.example", "?#x"];

  it.each(["https://testbed.example/ogc", "https://testbed.example"])(
    "every result under %s is a refusal, or on its origin, without userinfo, under its path",
    (baseUrl) => {
      const endpoint = publicEndpoint(baseUrl);
      const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
      for (const path of paths) {
        for (const search of searches) {
          const target = resolveReadTarget(endpoint, path, search);
          if (typeof target === "string") continue;
          const label = JSON.stringify({ path, search });
          expect(target.origin, label).toBe("https://testbed.example");
          expect(target.username, label).toBe("");
          expect(target.password, label).toBe("");
          expect(isUnderBase(target, baseUrl), label).toBe(true);
          expect(
            target.pathname === basePath || target.pathname.startsWith(`${basePath}/`),
            label,
          ).toBe(true);
        }
      }
    },
  );
});
