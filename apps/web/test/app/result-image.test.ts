/**
 * #29: a small image is shown with its longer side at 128px, its shape kept.
 */

import { describe, expect, it } from "vitest";
import { enlargedSize, SMALL_IMAGE } from "../../src/app/ResultImage.js";

describe("enlargedSize", () => {
  it("brings the longer side to 128px, keeping the shape", () => {
    expect(SMALL_IMAGE).toBe(128);
    expect(enlargedSize(16, 16)).toEqual({ width: 128, height: 128 });
    expect(enlargedSize(32, 16)).toEqual({ width: 128, height: 64 });
    expect(enlargedSize(10, 30)).toEqual({ width: 43, height: 128 });
  });

  it("leaves an image of 128px or more as it is, and one with no size", () => {
    expect(enlargedSize(128, 16)).toBeUndefined();
    expect(enlargedSize(1024, 768)).toBeUndefined();
    expect(enlargedSize(0, 0)).toBeUndefined();
  });
});
