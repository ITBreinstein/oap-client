/**
 * #20 and #21: a clicked feature's values, shown for reading, and whether a
 * shape has any.
 */

import { describe, expect, it } from "vitest";
import {
  formatNumber,
  hasProperties,
  shownValue,
  webAddress,
} from "../../src/app/property-value.js";

describe("formatNumber", () => {
  it("groups digits the Dutch way from five digits on, and keeps every decimal", () => {
    expect(formatNumber(12345)).toBe("12.345");
    expect(formatNumber(1234567.891)).toBe("1.234.567,891");
    expect(formatNumber(-45000.5)).toBe("-45.000,5");
    expect(formatNumber(0.000123)).toBe("0,000123");
  });

  it("leaves a four-digit number, such as a year, alone", () => {
    expect(formatNumber(1923)).toBe("1923");
    expect(formatNumber(7)).toBe("7");
  });
});

describe("webAddress", () => {
  it("is a whole http or https address", () => {
    expect(webAddress("https://bag.basisregistraties.overheid.nl/pand/0363")).toBe(
      "https://bag.basisregistraties.overheid.nl/pand/0363",
    );
    expect(webAddress(" http://example.org ")).toBe("http://example.org/");
  });

  it("is nothing for any other scheme, or words around an address", () => {
    expect(webAddress("javascript:alert(1)")).toBeUndefined();
    expect(webAddress("ftp://example.org/file")).toBeUndefined();
    expect(webAddress("see https://example.org")).toBeUndefined();
    expect(webAddress("https://exa mple.org")).toBeUndefined();
  });
});

describe("shownValue", () => {
  it("makes a web address a link", () => {
    expect(shownValue("https://example.org/a")).toEqual({
      kind: "link",
      href: "https://example.org/a",
    });
  });

  it("shows text as it is, numbers grouped, true and false and null in words", () => {
    expect(shownValue("Damrak 1")).toEqual({ kind: "text", text: "Damrak 1" });
    expect(shownValue(25000)).toEqual({ kind: "text", text: "25.000" });
    expect(shownValue(false)).toEqual({ kind: "text", text: "false" });
    expect(shownValue(null)).toEqual({ kind: "text", text: "null" });
  });

  it("shows a short list as words separated by commas", () => {
    expect(shownValue(["wonen", "kantoor"])).toEqual({ kind: "text", text: "wonen, kantoor" });
    expect(shownValue([1923, 12345])).toEqual({ kind: "text", text: "1923, 12.345" });
  });

  it("separates the items by semicolons when one has a decimal comma", () => {
    expect(shownValue([5.1, 52.05, 5.2, 52.12])).toEqual({
      kind: "text",
      text: "5,1; 52,05; 5,2; 52,12",
    });
  });

  it("shows a long list, a list of objects, an empty list and an object as JSON", () => {
    const long = Array.from({ length: 11 }, (_, index) => index);
    expect(shownValue(long).kind).toBe("json");
    expect(shownValue([{ a: 1 }]).kind).toBe("json");
    expect(shownValue(["x".repeat(41)]).kind).toBe("json");
    expect(shownValue([])).toEqual({ kind: "json", text: "[]" });
    expect(shownValue({ a: 1 })).toEqual({ kind: "json", text: '{\n  "a": 1\n}' });
  });
});

describe("hasProperties", () => {
  it("is true for a feature with at least one property", () => {
    expect(hasProperties({ kind: "feature", properties: { name: "A" } })).toBe(true);
  });

  it("is false for a bare geometry, null or empty properties", () => {
    expect(hasProperties({ kind: "bare-geometry" })).toBe(false);
    expect(hasProperties({ kind: "feature", properties: null })).toBe(false);
    expect(hasProperties({ kind: "feature", properties: {} })).toBe(false);
  });

  it("is true for properties that are not an object: there is something to show", () => {
    expect(hasProperties({ kind: "feature", properties: "odd" })).toBe(true);
  });
});
