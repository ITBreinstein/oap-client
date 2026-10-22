/**
 * #9: a search matches every word typed, in any order, in any case.
 */

import { describe, expect, it } from "vitest";
import { matchesWords, queryWords } from "../../src/app/word-search.js";

const BUILDINGS = [
  "Buildings in an area",
  "The buildings of Amsterdam, from the BAG.",
  "breinstein-buildings",
];

describe("queryWords", () => {
  it("is the words, lower case, without the spaces around them", () => {
    expect(queryWords("  Buildings   IN\tan ")).toEqual(["buildings", "in", "an"]);
    expect(queryWords("")).toEqual([]);
    expect(queryWords("   ")).toEqual([]);
  });
});

describe("matchesWords", () => {
  it("matches every word, in any order, across the texts", () => {
    expect(matchesWords("amsterdam buildings", BUILDINGS)).toBe(true);
    expect(matchesWords("AREA bag", BUILDINGS)).toBe(true);
    expect(matchesWords("breinstein-buildings", BUILDINGS)).toBe(true);
  });

  it("matches part of a word", () => {
    expect(matchesWords("build amst", BUILDINGS)).toBe(true);
  });

  it("does not match when one word is missing", () => {
    expect(matchesWords("buildings rotterdam", BUILDINGS)).toBe(false);
  });

  it("does not join two texts into one word", () => {
    expect(matchesWords("areathe", BUILDINGS)).toBe(false);
  });

  it("matches everything when nothing is typed", () => {
    expect(matchesWords("", BUILDINGS)).toBe(true);
    expect(matchesWords("  ", [])).toBe(true);
  });
});
