import type { FeatureCollection } from "geojson";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { type DrawState, type PolygonDraw, createPolygonDraw } from "./draw-polygon.js";

export interface PolygonDrawMapProps {
  readonly onChange: (features: FeatureCollection) => void;
  /** CSS height for the map. A map with no height renders nothing at all. */
  readonly height?: string;
}

/**
 * Owns the lifecycle of a drawable map.
 *
 * The map is created once and torn down on unmount; it is never recreated
 * because `onChange` changed identity, which would throw away whatever the user
 * had drawn. The callback is therefore read through a ref rather than captured.
 */
export function PolygonDrawMap({ onChange, height = "320px" }: PolygonDrawMapProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const drawing = useRef<PolygonDraw | undefined>(undefined);
  const latestOnChange = useRef(onChange);
  const [state, setState] = useState<DrawState>({ placing: false, hasSelection: false });

  useEffect(() => {
    latestOnChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;

    const created = createPolygonDraw({
      container: element,
      onChange: (features) => {
        latestOnChange.current(features);
      },
      onStateChange: setState,
    });
    drawing.current = created;

    return () => {
      created.destroy();
      drawing.current = undefined;
    };
  }, []);

  return (
    <div>
      <p>
        <button
          type="button"
          disabled={state.placing}
          onClick={() => {
            drawing.current?.addPolygon();
          }}
        >
          {state.placing ? "Placing…" : "Add polygon"}
        </button>{" "}
        <button
          type="button"
          disabled={!state.hasSelection}
          onClick={() => {
            drawing.current?.deleteSelected();
          }}
        >
          Delete shape
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            drawing.current?.undo();
          }}
        >
          Undo
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            drawing.current?.redo();
          }}
        >
          Redo
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            drawing.current?.clear();
          }}
        >
          Clear
        </button>
      </p>
      <div ref={container} style={{ height, width: "100%" }} data-testid="draw-map" />
      <p>
        {state.placing
          ? "Click to place each corner. Click the first corner again, or double-click, to close the shape — editing resumes by itself."
          : "Click a shape to select it, then: drag a corner to move it, click or drag a midpoint to add one, right-click a corner to remove it. Escape deselects. A triangle keeps all three corners — a polygon cannot have fewer."}
      </p>
    </div>
  );
}
