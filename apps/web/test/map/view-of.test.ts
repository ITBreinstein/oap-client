/**
 * #18: what the map shows, for "Use the current map view": west, south,
 * east, north, kept to longitude's and latitude's ranges.
 */

import { describe, expect, it } from "vitest";
import { viewOf } from "../../src/map/MapView.js";

function mapShowing(west: number, south: number, east: number, north: number) {
  return {
    getBounds: () => ({
      getWest: () => west,
      getSouth: () => south,
      getEast: () => east,
      getNorth: () => north,
    }),
  } as never;
}

describe("viewOf", () => {
  it("is the view's edges, to six decimals", () => {
    expect(viewOf(mapShowing(4.12345678, 52.1, 5.98765432, 52.6))).toEqual([
      4.123457, 52.1, 5.987654, 52.6,
    ]);
  });

  it("keeps to one world when zoomed out past it", () => {
    expect(viewOf(mapShowing(-250, -95, 250, 95))).toEqual([-180, -90, 180, 90]);
  });

  it("is nothing when the map can't say", () => {
    expect(
      viewOf({
        getBounds: () => {
          throw new Error("no map");
        },
      }),
    ).toBeUndefined();
  });
});
