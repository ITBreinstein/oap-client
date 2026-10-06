/**
 * JSON text read so that its numbers are sent as written (W28), and the
 * numbers a browser without source text access would change.
 */

import { describe, expect, it } from "vitest";
import { inexactNumbers, parseExact } from "../../src/forms/exact-json.js";
import { withoutSourceText } from "./helpers.js";

/** What the core puts on the wire. */
const wire = (text: string): string => JSON.stringify(parseExact(text));

describe("parseExact", () => {
  it("keeps a number a double cannot hold as written", () => {
    expect(wire('{"objectId":1234567890123456789}')).toBe('{"objectId":1234567890123456789}');
    expect(wire("[1e400, -1e400]")).toBe("[1e400,-1e400]");
    expect(wire("0.12345678901234567890")).toBe("0.12345678901234567890");
  });

  it("leaves a number a double holds exactly as a plain number", () => {
    const parsed = parseExact('{"a":1.0,"b":1e2,"c":0.1,"d":-0,"e":5e-324}');
    expect(parsed).toEqual({ a: 1, b: 100, c: 0.1, d: -0, e: 5e-324 });
  });

  it("does not touch digits inside a string", () => {
    expect(parseExact('{"id":"1234567890123456789"}')).toEqual({ id: "1234567890123456789" });
  });

  it("throws what JSON.parse throws", () => {
    expect(() => parseExact("{ half")).toThrow(SyntaxError);
  });

  it("is JSON.parse in a browser without source text access", () => {
    withoutSourceText(() => {
      expect(wire('{"objectId":1234567890123456789}')).toBe('{"objectId":1234567890123456800}');
    });
  });
});

describe("inexactNumbers", () => {
  it("lists none where the browser keeps numbers as written", () => {
    expect(inexactNumbers("[1234567890123456789, 1e400]")).toEqual([]);
  });

  it("names each number a browser without source text access would change, and what it would send", () => {
    withoutSourceText(() => {
      expect(inexactNumbers('{"a":1234567890123456789,"b":[1e400,2.50],"c":"1e400"}')).toEqual([
        { written: "1234567890123456789", sent: "1234567890123456800" },
        { written: "1e400", sent: "null" },
      ]);
    });
  });

  it("lists none for text that does not parse, which the validator reports on its own", () => {
    withoutSourceText(() => {
      expect(inexactNumbers("[1e400")).toEqual([]);
    });
  });
});
