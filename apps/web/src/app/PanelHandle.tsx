/**
 * STYLE TRIAL (updated Instrument, #36): the edge between the form and the
 * map, to make the form wider or narrower. A window splitter (WAI-ARIA): it
 * takes the focus, says its width, and the arrow keys, Home and End move it,
 * as dragging does.
 */

import { useRef, type PointerEvent } from "react";
import { clampPanel, PANEL_MAX, PANEL_MIN, widthForKey } from "./panel-width.js";

export function PanelHandle({
  width,
  onWidth,
}: {
  readonly width: number;
  readonly onWidth: (width: number) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  /** Where the panel starts on the page, while dragging. */
  const dragFrom = useRef<number | undefined>(undefined);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragFrom.current === undefined) return;
    onWidth(clampPanel(event.clientX - dragFrom.current));
  };

  return (
    // A landmark of its own, small as it is: everything on the page is in one.
    <div className="panel-handle-region" role="region" aria-label="Form width">
      <div
        ref={handle}
        className="panel-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Width of the form"
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        aria-valuenow={width}
        aria-valuetext={`${String(width)} pixels`}
        tabIndex={0}
        onKeyDown={(event) => {
          const next = widthForKey(event.key, width);
          if (next === undefined) return;
          event.preventDefault();
          onWidth(next);
        }}
        onPointerDown={(event) => {
          const panel = handle.current?.closest(".layout")?.querySelector(".panel");
          if (panel === null || panel === undefined) return;
          dragFrom.current = panel.getBoundingClientRect().left;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          dragFrom.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
    </div>
  );
}
