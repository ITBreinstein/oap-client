/**
 * #13: invalid JSON is said in plain words, with the line to look at when
 * the parser gives one, whichever browser's parser it is.
 */

import { describe, expect, it } from "vitest";
import { jsonTrouble, lineOfMessage, plainJsonMessage } from "../../src/forms/json-trouble.js";

describe("lineOfMessage", () => {
  const text = '{\n\t"a": 1,\n\t"b": }';

  it("reads a line the parser names", () => {
    expect(
      lineOfMessage(text, "Unexpected token '}', ... is not valid JSON (line 3 column 7)"),
    ).toBe(3);
    expect(
      lineOfMessage(text, "JSON.parse: unexpected character at line 3 column 7 of the JSON data"),
    ).toBe(3);
  });

  it("counts the lines up to a position the parser names", () => {
    expect(lineOfMessage(text, "Unexpected token } in JSON at position 16")).toBe(3);
    expect(lineOfMessage(text, "Unexpected token in JSON at position 0")).toBe(1);
  });

  it("is unknown when the parser says neither", () => {
    expect(lineOfMessage(text, 'JSON Parse error: Unexpected identifier "b"')).toBeUndefined();
  });
});

describe("jsonTrouble", () => {
  it("is nothing for valid JSON", () => {
    expect(jsonTrouble('{ "a": [1, 2] }')).toBeUndefined();
  });

  it("finds the line with this engine's parser, and keeps its words", () => {
    const trouble = jsonTrouble('{\n\t"a": 1,\n\t"b" 2\n}');
    expect(trouble?.line).toBe(3);
    expect(trouble?.atEnd).toBe(false);
    expect(trouble?.detail).toMatch(/\S/);
  });

  it("says when the text stops too soon", () => {
    expect(jsonTrouble('{ "a": [1, 2')?.atEnd).toBe(true);
  });
});

describe("plainJsonMessage", () => {
  it("names the line, the end, or nothing", () => {
    expect(plainJsonMessage({ line: 1, atEnd: false, detail: "" })).toBe(
      "This isn’t valid JSON: check the quotes and brackets near line 1.",
    );
    expect(plainJsonMessage({ line: 1, atEnd: true, detail: "" })).toBe(
      "This isn’t valid JSON: check the quotes and brackets near the end.",
    );
    expect(plainJsonMessage({ line: undefined, atEnd: false, detail: "" })).toBe(
      "This isn’t valid JSON: check the quotes and brackets.",
    );
  });
});
