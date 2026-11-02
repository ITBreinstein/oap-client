/**
 * The form as a sheet over the map, on a phone (updated Instrument): the map
 * fills the screen and the form is a sheet along its foot, as a maps app
 * has it. Three heights: a strip with the process's name and Run, half the
 * screen, or nearly all of it. `SheetHandle.tsx` moves between them;
 * `style-instrument-updated.css` says how tall each is.
 */

export const SHEET_SIZES = ["peek", "half", "full"] as const;
export type SheetSize = (typeof SHEET_SIZES)[number];

/** Where the sheet starts: the form and the map both in view. */
export const SHEET_START: SheetSize = "half";

/** A press on the handle: one step taller, and from the tallest back to the strip. */
export function nextSheetSize(size: SheetSize): SheetSize {
  switch (size) {
    case "peek":
      return "half";
    case "half":
      return "full";
    case "full":
      return "peek";
  }
}

/** What a press on the handle does, as its name. */
export function sheetHandleLabel(size: SheetSize): string {
  switch (size) {
    case "peek":
      return "Show the form";
    case "half":
      return "Show the whole form";
    case "full":
      return "Show the map";
  }
}

/** The arrow keys on the handle: up is taller, down is shorter; undefined for any other key. */
export function sheetSizeForKey(key: string, size: SheetSize): SheetSize | undefined {
  const at = SHEET_SIZES.indexOf(size);
  if (key === "ArrowUp") return SHEET_SIZES[Math.min(at + 1, SHEET_SIZES.length - 1)];
  if (key === "ArrowDown") return SHEET_SIZES[Math.max(at - 1, 0)];
  return undefined;
}

/** Where a drag that let go at this share of the height comes to rest. */
export function sheetSizeForShare(share: number): SheetSize {
  if (share < 0.32) return "peek";
  if (share < 0.75) return "half";
  return "full";
}
