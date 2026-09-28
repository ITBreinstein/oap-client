/**
 * The browser's mixed-content rule, as the page applies it before sending:
 * from an HTTPS page, plain `http:` is refused unless the host is one the
 * browser treats as secure — loopback.
 */

import { describe, expect, it } from "vitest";
import { isMixedContent } from "../src/mixed-content.js";

const refused = (address: string, page: string | undefined = "https:"): boolean =>
  isMixedContent(new URL(address), page);

describe("from an https: page", () => {
  it("refuses plain http: to a public host", () => {
    expect(refused("http://ogc.example.org/api")).toBe(true);
    expect(refused("http://93.184.215.14:8080/")).toBe(true);
  });

  it.each(["http://localhost:5080", "http://127.0.0.1:5080", "http://[::1]:5080"])(
    "exempts %s, as the browser does",
    (address) => {
      expect(refused(address)).toBe(false);
    },
  );

  it("exempts the rest of what the browser counts as loopback", () => {
    expect(refused("http://api.localhost:5080")).toBe(false);
    expect(refused("http://127.0.0.2/")).toBe(false);
  });

  it("does not exempt a name that only looks local", () => {
    expect(refused("http://localhost.example.org/")).toBe(true);
    expect(refused("http://127.0.0.1.example.org/")).toBe(true);
  });

  it("never refuses https:", () => {
    expect(refused("https://ogc.example.org/api")).toBe(false);
  });
});

describe("from an http: page, or off-browser", () => {
  it("refuses nothing", () => {
    expect(refused("http://ogc.example.org/api", "http:")).toBe(false);
    expect(isMixedContent(new URL("http://ogc.example.org/api"), undefined)).toBe(false);
  });
});
