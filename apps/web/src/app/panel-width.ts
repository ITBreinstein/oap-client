/**
 * STYLE TRIAL (updated Instrument, #36): how wide the form's panel is beside
 * the map, which the visitor can change between these bounds, by dragging
 * its edge or with the arrow keys on it. Kept for the visit, in memory. At
 * 440px a box's four coordinates fit two to a row, labels on one line.
 */

export const PANEL_MIN = 440;
export const PANEL_MAX = 640;
export const PANEL_START = 440;
/** How far one press of an arrow key moves the edge. */
export const PANEL_STEP = 16;

/** A width kept within the bounds, in whole pixels. */
export function clampPanel(width: number): number {
  if (!Number.isFinite(width)) return PANEL_START;
  return Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)));
}

/** The width a key on the handle asks for; undefined for a key it ignores. */
export function widthForKey(key: string, width: number): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return clampPanel(width - PANEL_STEP);
    case "ArrowRight":
      return clampPanel(width + PANEL_STEP);
    case "Home":
      return PANEL_MIN;
    case "End":
      return PANEL_MAX;
    default:
      return undefined;
  }
}
