/**
 * #22: an input is described by what it holds on the map: a point, a line,
 * an area, or a mix.
 */

import { describe, expect, it } from "vitest";
import { legendKind, legendNoun, onMapSentence, shapeKinds } from "../../src/app/shape-words.js";

const point = { type: "Point" };
const line = { type: "LineString" };
const area = { type: "Polygon" };

describe("shapeKinds", () => {
  it("counts each kind", () => {
    expect(shapeKinds([point, area, area])).toEqual({ points: 1, lines: 0, areas: 2 });
  });
});

describe("onMapSentence", () => {
  it("names a point, a line or an area as the map draws it", () => {
    expect(onMapSentence(shapeKinds([point]))).toBe("Shown on the map as the amber point.");
    expect(onMapSentence(shapeKinds([line]))).toBe("Shown on the map as the dashed line.");
    expect(onMapSentence(shapeKinds([area]))).toBe("Shown on the map as the dashed outline.");
  });

  it("counts, and names a mix", () => {
    expect(onMapSentence(shapeKinds([area, area]))).toBe(
      "Shown on the map as the dashed outlines.",
    );
    expect(onMapSentence(shapeKinds([point, line, area, area]))).toBe(
      "Shown on the map as the amber point, dashed line and dashed outlines.",
    );
    expect(onMapSentence(shapeKinds([point, point, line]))).toBe(
      "Shown on the map as the amber points and dashed line.",
    );
  });

  it("says no more than that with nothing to name", () => {
    expect(onMapSentence(shapeKinds([]))).toBe("Shown on the map.");
  });
});

describe("the legend", () => {
  it("names the one kind an input holds, and says input for a mix", () => {
    expect(legendNoun(shapeKinds([point]))).toBe("point");
    expect(legendNoun(shapeKinds([line, line]))).toBe("lines");
    expect(legendNoun(shapeKinds([area]))).toBe("area");
    expect(legendNoun(shapeKinds([point, area]))).toBe("input");
  });

  it("shows the swatch of the one kind, an area's for a mix", () => {
    expect(legendKind(shapeKinds([point, point]))).toBe("point");
    expect(legendKind(shapeKinds([line]))).toBe("line");
    expect(legendKind(shapeKinds([area]))).toBe("area");
    expect(legendKind(shapeKinds([point, line]))).toBe("area");
  });
});
