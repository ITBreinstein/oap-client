/**
 * #36: the form's width beside the map, between 440 and 640px, by the keys a
 * window splitter takes.
 */

import { describe, expect, it } from "vitest";
import {
  clampPanel,
  PANEL_MAX,
  PANEL_MIN,
  PANEL_START,
  PANEL_STEP,
  widthForKey,
} from "../../src/app/panel-width.js";

describe("clampPanel", () => {
  it("keeps a width within 440 and 640, in whole pixels", () => {
    expect(clampPanel(300)).toBe(PANEL_MIN);
    expect(clampPanel(900)).toBe(PANEL_MAX);
    expect(clampPanel(512.6)).toBe(513);
    expect(clampPanel(Number.NaN)).toBe(PANEL_START);
  });
});

describe("widthForKey", () => {
  it("moves the edge a step with the arrow keys, to an end with Home and End", () => {
    expect(widthForKey("ArrowRight", 480)).toBe(480 + PANEL_STEP);
    expect(widthForKey("ArrowLeft", 500)).toBe(500 - PANEL_STEP);
    expect(widthForKey("ArrowLeft", PANEL_MIN)).toBe(PANEL_MIN);
    expect(widthForKey("ArrowRight", PANEL_MAX)).toBe(PANEL_MAX);
    expect(widthForKey("Home", 500)).toBe(PANEL_MIN);
    expect(widthForKey("End", 500)).toBe(PANEL_MAX);
  });

  it("ignores other keys", () => {
    expect(widthForKey("Enter", 500)).toBeUndefined();
  });
});
