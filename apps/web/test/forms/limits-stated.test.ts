/**
 * #14: the page's limit line is left out where the description already says
 * the same numbers.
 */

import { describe, expect, it } from "vitest";
import { limitsStated, numbersIn } from "../../src/forms/limits-stated.js";

describe("numbersIn", () => {
  it("finds numbers in figures, negative and decimal ones too", () => {
    expect([...numbersIn("From -5 to 10, 0.5 unless changed; at most 1000 m")]).toEqual([
      -5, 10, 0.5, 1000,
    ]);
  });

  it("finds numbers in words up to twenty, whatever their case", () => {
    expect([...numbersIn("Up to Three short strings, or twenty")]).toEqual([3, 20]);
  });

  it("does not find a number inside a word", () => {
    expect([...numbersIn("Someone, often, none")]).toEqual([]);
  });
});

describe("limitsStated", () => {
  it("is true when every limit is named", () => {
    expect(limitsStated("A whole number from 1 to 10.", [1, 10])).toBe(true);
    expect(limitsStated("A short string of at most 20 characters.", [20])).toBe(true);
    expect(limitsStated("Up to three short strings.", [3])).toBe(true);
  });

  it("is false when one is missing, or the number differs", () => {
    expect(limitsStated("A whole number, at most 10.", [1, 10])).toBe(false);
    expect(limitsStated("A whole number from 1 to 100.", [1, 10])).toBe(false);
    expect(limitsStated("At most 20.5 characters.", [20])).toBe(false);
  });

  it("is false without a description or without limits", () => {
    expect(limitsStated(undefined, [1])).toBe(false);
    expect(limitsStated("From 1 to 10.", [])).toBe(false);
  });
});
