/**
 * STYLE TRIAL (instrument): when the other theme's backdrop is fetched ahead
 * of time, and which picture belongs to which theme.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKDROP, saveDataRequested, shouldPrefetch } from "../../src/app/backdrop.js";
import type { StyleName } from "../../src/app/appearance.js";

describe("shouldPrefetch", () => {
  const cases: [StyleName, boolean, boolean][] = [
    ["instrument", false, true],
    ["instrument", true, false],
    ["hybrid", false, false],
    ["hybrid", true, false],
    ["precise", false, false],
    ["precise", true, false],
  ];

  it.each(cases)("%s, save data %s: %s", (style, saveData, expected) => {
    expect(shouldPrefetch(style, saveData)).toBe(expected);
  });
});

describe("saveDataRequested", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the connection's Save-Data flag", () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    expect(saveDataRequested()).toBe(true);
    vi.stubGlobal("navigator", { connection: { saveData: false } });
    expect(saveDataRequested()).toBe(false);
  });

  it("is false where the browser doesn't say", () => {
    vi.stubGlobal("navigator", {});
    expect(saveDataRequested()).toBe(false);
  });
});

describe("BACKDROP", () => {
  it("shows the day by light and the night by dark", () => {
    expect(BACKDROP.light).toMatch(/europe-day[^/]*\.webp$/);
    expect(BACKDROP.dark).toMatch(/europe-night[^/]*\.webp$/);
  });
});
