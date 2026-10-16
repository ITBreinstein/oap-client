/**
 * When the other theme's backdrop is fetched ahead of time, and which
 * picture belongs to which theme.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKDROP, saveDataRequested, shouldPrefetch } from "../../src/app/backdrop.js";

describe("shouldPrefetch", () => {
  it("fetches ahead unless the connection saves data", () => {
    expect(shouldPrefetch(false)).toBe(true);
    expect(shouldPrefetch(true)).toBe(false);
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
