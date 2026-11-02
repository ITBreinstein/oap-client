/**
 * The grip at the top of the form's sheet on a phone (`sheet.ts`): a press
 * makes the sheet one step taller, or from the tallest back to a strip; the
 * arrow keys step up and down; a drag follows the finger and comes to rest at
 * the nearest height.
 *
 * While dragging, the sheet's height is set on the element itself, frame by
 * frame, and handed back to the stylesheet once the drag ends.
 */

import { useRef, type PointerEvent } from "react";
import {
  nextSheetSize,
  sheetHandleLabel,
  sheetSizeForKey,
  sheetSizeForShare,
  type SheetSize,
} from "./sheet.js";

/** Less than this, in pixels, and a press that moved is still a press. */
const DRAG_THRESHOLD = 6;

interface Drag {
  readonly pointer: number;
  readonly fromY: number;
  readonly fromHeight: number;
  readonly layout: HTMLElement;
  readonly sheet: HTMLElement;
  moved: boolean;
}

export function SheetHandle({
  size,
  onSize,
}: {
  readonly size: SheetSize;
  readonly onSize: (size: SheetSize) => void;
}) {
  const drag = useRef<Drag | undefined>(undefined);
  /** A drag ends in a click as well: that click is the drag's, not a press. */
  const swallowClick = useRef(false);

  const end = (event: PointerEvent<HTMLButtonElement>, settle: boolean) => {
    const current = drag.current;
    if (current?.pointer !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const share = current.sheet.getBoundingClientRect().height / current.layout.clientHeight;
    current.sheet.style.removeProperty("height");
    delete current.layout.dataset["sheetDragging"];
    if (!current.moved || !settle) return;
    swallowClick.current = true;
    onSize(sheetSizeForShare(share));
  };

  return (
    <div className="sheet-handle-region">
      <button
        type="button"
        className="sheet-handle"
        aria-label={sheetHandleLabel(size)}
        onClick={() => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          onSize(nextSheetSize(size));
        }}
        onKeyDown={(event) => {
          const next = sheetSizeForKey(event.key, size);
          if (next === undefined) return;
          event.preventDefault();
          onSize(next);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const sheet = event.currentTarget.closest<HTMLElement>(".panel");
          const layout = sheet?.closest<HTMLElement>(".layout") ?? null;
          if (sheet === null || layout === null) return;
          swallowClick.current = false;
          drag.current = {
            pointer: event.pointerId,
            fromY: event.clientY,
            fromHeight: sheet.getBoundingClientRect().height,
            layout,
            sheet,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current?.pointer !== event.pointerId) return;
          const by = current.fromY - event.clientY;
          if (!current.moved && Math.abs(by) < DRAG_THRESHOLD) return;
          if (!current.moved) {
            current.moved = true;
            current.layout.dataset["sheetDragging"] = "true";
          }
          const most = current.layout.clientHeight - 16;
          const height = Math.min(most, Math.max(48, current.fromHeight + by));
          current.sheet.style.height = `${String(height)}px`;
        }}
        onPointerUp={(event) => {
          end(event, true);
        }}
        onPointerCancel={(event) => {
          end(event, false);
        }}
      />
    </div>
  );
}
