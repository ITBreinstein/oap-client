/**
 * The form as a sheet over the map, on a phone: its three heights, what a
 * press, a key and a drag do.
 */

import { describe, expect, it } from "vitest";
import {
  nextSheetSize,
  SHEET_START,
  sheetHandleLabel,
  sheetSizeForKey,
  sheetSizeForShare,
} from "../../src/app/sheet.js";

describe("the form's sheet", () => {
  it("starts at half height, the form and the map both in view", () => {
    expect(SHEET_START).toBe("half");
  });

  it("goes one step taller on a press, and from the tallest back to a strip", () => {
    expect(nextSheetSize("peek")).toBe("half");
    expect(nextSheetSize("half")).toBe("full");
    expect(nextSheetSize("full")).toBe("peek");
  });

  it("names its grip by what a press does", () => {
    expect(sheetHandleLabel("peek")).toBe("Show the form");
    expect(sheetHandleLabel("half")).toBe("Show the whole form");
    expect(sheetHandleLabel("full")).toBe("Show the map");
  });

  it("steps up and down with the arrow keys, and stops at either end", () => {
    expect(sheetSizeForKey("ArrowUp", "peek")).toBe("half");
    expect(sheetSizeForKey("ArrowUp", "full")).toBe("full");
    expect(sheetSizeForKey("ArrowDown", "half")).toBe("peek");
    expect(sheetSizeForKey("ArrowDown", "peek")).toBe("peek");
    expect(sheetSizeForKey("Enter", "half")).toBeUndefined();
  });

  it("comes to rest at the nearest height when a drag lets go", () => {
    expect(sheetSizeForShare(0.1)).toBe("peek");
    expect(sheetSizeForShare(0.5)).toBe("half");
    expect(sheetSizeForShare(0.9)).toBe("full");
  });
});
