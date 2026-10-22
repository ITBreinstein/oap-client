/**
 * JSON laid out with tabs, every value kept as typed.
 */

import { describe, expect, it } from "vitest";
import { formatJsonText } from "../../src/app/json-text.js";

describe("formatJsonText", () => {
  it("puts each member and item on its own line, indented with tabs", () => {
    expect(formatJsonText('{"type":"Point","coordinates":[5.1,52.1]}')).toBe(
      '{\n\t"type": "Point",\n\t"coordinates": [\n\t\t5.1,\n\t\t52.1\n\t]\n}',
    );
  });

  it("keeps numbers and strings exactly as typed", () => {
    const typed =
      '{ "big": 12345678901234567890, "one": 1.0, "e": 1E+2, "s": "a, b: [c] \\"d\\"" }';
    const formatted = formatJsonText(typed) ?? "";
    expect(formatted).toContain("12345678901234567890");
    expect(formatted).toContain('"one": 1.0');
    expect(formatted).toContain('"e": 1E+2');
    expect(formatted).toContain('"s": "a, b: [c] \\"d\\""');
    // The same value, whitespace aside.
    expect(JSON.parse(formatted)).toEqual(JSON.parse(typed));
  });

  it("leaves empty containers on one line", () => {
    expect(formatJsonText('{"a": [ ], "b": {}}')).toBe('{\n\t"a": [],\n\t"b": {}\n}');
  });

  it("lays out a bare value, and gives nothing back for text that isn't JSON", () => {
    expect(formatJsonText("  42 ")).toBe("42");
    expect(formatJsonText('"x"')).toBe('"x"');
    expect(formatJsonText('{"a": 1')).toBeUndefined();
    expect(formatJsonText("")).toBeUndefined();
  });

  it("is stable: formatting formatted text changes nothing", () => {
    const once = formatJsonText('[{"a":[1,{"b":null}]},true]') ?? "";
    expect(formatJsonText(once)).toBe(once);
  });
});
