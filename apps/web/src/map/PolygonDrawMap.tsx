import type { FeatureCollection } from "geojson";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { type DrawState, type PolygonDraw, createPolygonDraw } from "./draw-polygon.js";
import { MAX_FILE_BYTES, describeLoad, partitionByType, readGeoJson } from "./geojson.js";

/** The only geometry this map can draw or hold, until a schema says otherwise. */
const ACCEPTED = ["Polygon"] as const;

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
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Reads a chosen file onto the map.
   *
   * Every outcome says something. A file that loads nothing, loads partly, or
   * is refused outright is worse than useless if the map simply stays as it
   * was — the user is left guessing whether anything happened.
   */
  const loadFile = (file: File): void => {
    if (file.size > MAX_FILE_BYTES) {
      setNotice("That file is larger than 10 MB, so it was not opened.");
      return;
    }

    file
      .text()
      .then((text) => {
        const read = readGeoJson(text);
        if (!read.ok) {
          setNotice(read.message);
          return;
        }

        const { usable, ignored } = partitionByType(read.features, ACCEPTED);
        if (usable.length === 0) {
          setNotice(`${file.name} contains no polygons, which is all this input can take.`);
          return;
        }

        const report = drawing.current?.setFeatures(usable);
        const refused = report?.rejected.length
          ? ` ${String(report.rejected.length)} refused: ${report.rejected.join("; ")}`
          : "";
        setNotice(describeLoad(usable, ignored) + refused);
      })
      .catch((cause: unknown) => {
        setNotice(cause instanceof Error ? cause.message : "That file could not be read.");
      });
  };

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
          onClick={() => {
            fileInput.current?.click();
          }}
        >
          Upload GeoJSON
        </button>{" "}
        {/*
          The native file input is hidden and driven by the button above: its
          own control is unstyleable and its "No file chosen" label tells
          nobody anything.
        */}
        <input
          ref={fileInput}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) loadFile(file);
            // Cleared so that choosing the same file twice fires again.
            event.target.value = "";
          }}
        />{" "}
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
      {/* Dropping a file on the map is the gesture people try first. */}
      <div
        ref={container}
        style={{ height, width: "100%" }}
        data-testid="draw-map"
        onDragOver={(event) => {
          // Without this the browser navigates away to the dropped file.
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) loadFile(file);
        }}
      />
      {notice !== undefined && <p data-testid="map-notice">{notice}</p>}
      <p>
        {state.placing
          ? "Click to place each corner. Click the first corner again, or double-click, to close the shape — editing resumes by itself."
          : "Click a shape to select it, then: drag a corner to move it, click or drag a midpoint to add one, right-click a corner to remove it. Escape deselects. A triangle keeps all three corners — a polygon cannot have fewer."}
      </p>
    </div>
  );
}
