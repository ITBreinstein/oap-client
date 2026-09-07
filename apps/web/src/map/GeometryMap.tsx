import type { FeatureCollection } from "geojson";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  type DrawState,
  type GeometryDraw,
  type Tool,
  createGeometryDraw,
  geometryTypeOf,
} from "./draw-geometry.js";
import { MAX_FILE_BYTES, describeLoad, partitionByType, readGeoJson } from "./geojson.js";

/** Toolbar wording, in the user's terms rather than GeoJSON's. */
const TOOL_LABELS: Record<Tool, string> = {
  Point: "Add point",
  LineString: "Add line",
  Polygon: "Add area",
  BoundingBox: "Add box",
};

const TOOL_HINTS: Record<Tool, string> = {
  Point: "Click to place the point.",
  LineString: "Click to place each point along the line; double-click to finish.",
  Polygon:
    "Click to place each corner. Click the first corner again, or double-click, to close the shape.",
  BoundingBox: "Drag to pull out a rectangle.",
};

export interface GeometryMapProps {
  readonly onChange: (features: FeatureCollection) => void;
  /**
   * Which tools to offer. Also decides what an uploaded file may contribute:
   * a map offering only areas has no use for the points in a file.
   */
  readonly tools?: readonly Tool[];
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
export function GeometryMap({
  onChange,
  tools = ["Polygon"],
  height = "320px",
}: GeometryMapProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const drawing = useRef<GeometryDraw | undefined>(undefined);
  const latestOnChange = useRef(onChange);
  const [state, setState] = useState<DrawState>({ placing: undefined, hasSelection: false });
  // The tool list is read once, when the map is built: it decides which Terra
  // Draw modes get registered. Keying the effect on its contents rather than
  // its identity means a caller passing a fresh array literal every render
  // does not tear the map down, while a genuinely different set does.
  const toolsKey = tools.join(",");
  const toolsRef = useRef(tools);
  // What an uploaded file may contribute, derived from the tools on offer.
  const accepted = [...new Set(tools.map(geometryTypeOf))];
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

        const { usable, ignored } = partitionByType(read.features, accepted);
        if (usable.length === 0) {
          setNotice(`${file.name} has nothing this input can take (${accepted.join(", ")}).`);
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
    toolsRef.current = tools;
  }, [onChange, tools]);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;

    const created = createGeometryDraw({
      container: element,
      tools: toolsRef.current,
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
  }, [toolsKey]);

  return (
    <div>
      <p>
        {tools.map((tool) => (
          <span key={tool}>
            <button
              type="button"
              // Disabled across the board while placing: switching tool
              // mid-shape would abandon it without saying so.
              disabled={state.placing !== undefined}
              onClick={() => {
                drawing.current?.add(tool);
              }}
            >
              {state.placing === tool ? "Placing…" : TOOL_LABELS[tool]}
            </button>{" "}
          </span>
        ))}
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
        {state.placing !== undefined
          ? `${TOOL_HINTS[state.placing]} Editing resumes by itself.`
          : "Click a shape to select it, then drag it or its points to move them. On a line or area: click or drag a midpoint to add a point, right-click a point to remove it. Escape deselects."}
      </p>
    </div>
  );
}
