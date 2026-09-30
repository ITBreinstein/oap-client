/**
 * The CRS a typed bounding box starts in: CRS84 whenever the process offers
 * it, and the declared CRS otherwise, as before.
 */

import { describe, expect, it } from "vitest";
import { CRS84, CRS84H, typedBboxCrs } from "../../src/forms/crs.js";

const EPSG4326 = "http://www.opengis.net/def/crs/EPSG/0/4326";
const RD = "http://www.opengis.net/def/crs/EPSG/0/28992";

describe("typedBboxCrs", () => {
  it("prefers CRS84 over another declared default", () => {
    expect(typedBboxCrs({ crs: [EPSG4326, CRS84], defaultCrs: EPSG4326, dimensions: [4] })).toBe(
      CRS84,
    );
    expect(typedBboxCrs({ crs: [RD, CRS84], defaultCrs: RD, dimensions: [4] })).toBe(CRS84);
  });

  it("prefers CRS84h for an input that takes six numbers only", () => {
    expect(typedBboxCrs({ crs: [CRS84, CRS84H], defaultCrs: CRS84, dimensions: [6] })).toBe(CRS84H);
  });

  it("keeps the declared default where CRS84 is not offered", () => {
    expect(typedBboxCrs({ crs: [EPSG4326, RD], defaultCrs: EPSG4326, dimensions: [4] })).toBe(
      EPSG4326,
    );
    // As before: a projected default gives way to a CRS a map-drawn box can use.
    expect(typedBboxCrs({ crs: [RD, EPSG4326], defaultCrs: RD, dimensions: [4] })).toBe(EPSG4326);
    expect(typedBboxCrs({ crs: [RD], defaultCrs: RD, dimensions: [4] })).toBe(RD);
  });
});
