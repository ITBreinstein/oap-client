/**
 * The map beside the form, and the translation between the two.
 *
 * The map binding knows four numbers and shapes; the form knows the plan. This
 * is where a field's value becomes something the map can show, and what was
 * drawn becomes the field's value:
 *
 * - a bbox field: `[west, south, east, north]`, in a CRS the server accepts —
 *   CRS84 when it offers that, EPSG:4326 otherwise, with the encoder swapping
 *   the axes on the way out (T9). Nothing here reprojects.
 * - a geometry field, or a complex field's JSON-object format: shapes, turned
 *   into GeoJSON text in the wrapper and geometry types the plan allows.
 *
 * Every geometry the inputs hold is shown as the input layer — amber and
 * dashed, apart from a result's blue — while the form is filled in, so a
 * loaded file is seen before it is sent. While a run is under way and once
 * its result is in, nothing is drawn: the map shows what was sent and, once it
 * is in, every result that is GeoJSON, and an image result over the area a box
 * beside it gives (`results/plottable.ts`).
 */

import { useState } from "react";
import { drawableCrs, isDrawableCrs } from "../forms/crs.js";
import type { BboxValue, ComplexValue, GeoJsonText } from "../forms/encode.js";
import {
  ANY_FEATURE_COLLECTION,
  drawableTypes,
  holdsSeveral,
  shapesOfText,
  toGeoJson,
  type GeometryTarget,
} from "../forms/geometry.js";
import type { FieldPlan } from "../forms/plan.js";
import type { Bbox } from "../map/bbox.js";
import type { MapShape, Tool } from "../map/geometry-engine.js";
import { MapView } from "../map/MapView.js";
import type { ShownShapes } from "../map/shape-layers.js";
import { mapImage, plottedFeatures, plottedShapes } from "../results/plottable.js";
import type { RenderableResult } from "../results/renderable.js";
import { FeatureProperties } from "./FeatureProperties.js";
import type { GeometryDrawProps } from "../map/useGeometryDraw.js";
import type { DrawTarget } from "./draw.js";
import { useDataUrl } from "./useDataUrl.js";
import type { Workflow } from "./workflow.js";

function toBbox(value: unknown): Bbox | undefined {
  if (typeof value !== "object" || value === null || !("coordinates" in value)) return undefined;
  const coordinates: unknown = value.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 4) return undefined;
  const numbers = coordinates.filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
  const [west, south, east, north] = numbers;
  return west === undefined || south === undefined || east === undefined || north === undefined
    ? undefined
    : [west, south, east, north];
}

function readText(record: unknown, key: string): string | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const text: unknown = (record as Record<string, unknown>)[key];
  return typeof text === "string" ? text : undefined;
}

function readFormat(record: unknown): number {
  if (typeof record !== "object" || record === null) return 0;
  const format: unknown = (record as Record<string, unknown>)["format"];
  return typeof format === "number" ? format : 0;
}

/** How a field holds GeoJSON, if the map can draw for it in its current state. */
interface ShapeBinding {
  readonly target: GeometryTarget;
  readonly text: string;
  readonly write: (text: string) => unknown;
}

function shapeBinding(field: FieldPlan, current: unknown): ShapeBinding | undefined {
  const { control } = field;
  if (control.kind === "geometry") {
    return {
      target: control,
      text: readText(current, "geojson") ?? "",
      write: (text) => {
        const value: GeoJsonText = { geojson: text };
        return text === "" ? undefined : value;
      },
    };
  }
  if (control.kind === "complex") {
    const format = readFormat(current);
    if (control.formats[format]?.object !== true || readText(current, "href") !== undefined) {
      return undefined;
    }
    return {
      target: ANY_FEATURE_COLLECTION,
      text: readText(current, "value") ?? "",
      write: (text) => {
        const value: ComplexValue = { format, value: text };
        return value;
      },
    };
  }
  return undefined;
}

function toolsFor(target: GeometryTarget): Tool[] {
  const types = drawableTypes(target);
  return types.includes("Polygon") ? [...types, "Rectangle"] : [...types];
}

/**
 * The map's part of the form and of a run: every geometry the inputs hold —
 * loaded, typed or drawn — and, once it is in, what came back.
 *
 * Shown while the form is being filled in too, so a loaded file is seen
 * before it is sent. The field the map is drawing for is left out: the draw
 * mode shows that one itself, editable, and showing it twice would put a
 * stale copy under the one being edited.
 *
 * Derived from the workflow on every render, never stored: when another
 * process is opened its fresh values hold no geometry, and a field that is
 * gone contributes none, so the input layer empties without anything having
 * to remove it.
 */
export function shownFor(state: Workflow, drawing?: string): readonly ShownShapes[] {
  if (state.stage !== "process" && state.stage !== "running" && state.stage !== "result") {
    return [];
  }
  const input = state.plan.fields.flatMap((field) => {
    if (state.stage === "process" && field.id === drawing) return [];
    const current = Object.hasOwn(state.values, field.id) ? state.values[field.id] : undefined;
    const binding = shapeBinding(field, current);
    return binding === undefined ? [] : shapesOfText(binding.text);
  });
  const result = state.stage === "result" ? plottedShapes(state.results) : [];
  return [
    { role: "input", shapes: input },
    { role: "result", shapes: result },
  ];
}

const INACTIVE: GeometryDrawProps = {
  active: false,
  tools: [],
  several: false,
  value: [],
  onChange: () => undefined,
};

export function MapPane({
  state,
  draw,
  setValue,
  onAvailable,
}: {
  readonly state: Workflow;
  readonly draw: DrawTarget;
  readonly setValue: (id: string, value: unknown) => void;
  readonly onAvailable: (available: boolean) => void;
}) {
  const field =
    state.stage === "process" && draw.fieldId !== undefined
      ? state.plan.fields.find((candidate) => candidate.id === draw.fieldId)
      : undefined;
  const control = field?.control.kind === "bbox" ? field.control : undefined;
  const current =
    field !== undefined && state.stage === "process" && Object.hasOwn(state.values, field.id)
      ? state.values[field.id]
      : undefined;
  const currentCrs =
    typeof current === "object" &&
    current !== null &&
    "crs" in current &&
    typeof current.crs === "string"
      ? current.crs
      : undefined;
  const shapes = field === undefined ? undefined : shapeBinding(field, current);

  const geometry: GeometryDrawProps =
    field === undefined || shapes === undefined
      ? INACTIVE
      : {
          active: true,
          tools: toolsFor(shapes.target),
          several: holdsSeveral(shapes.target),
          value: shapesOfText(shapes.text),
          onChange: (drawn: readonly MapShape[]) => {
            const { geojson } = toGeoJson(shapes.target, drawn);
            setValue(field.id, shapes.write(geojson === undefined ? "" : JSON.stringify(geojson)));
          },
        };

  const shown = shownFor(state, field === undefined ? undefined : draw.fieldId);
  // A click picks a result shape by its index among the plotted ones — the
  // order `shownFor` shows them in. Held with the results it was made on, so
  // a new run, or leaving the result, drops it without anything noticing.
  const [picked, setPicked] = useState<
    { readonly results: readonly RenderableResult[]; readonly index: number } | undefined
  >();
  const results = state.stage === "result" ? state.results : undefined;
  const selected =
    results !== undefined && picked?.results === results
      ? plottedFeatures(results)[picked.index]
      : undefined;
  const placed = state.stage === "result" ? mapImage(state.results) : undefined;
  const imageUrl = useDataUrl(placed?.blob);
  const image =
    placed === undefined || imageUrl === undefined
      ? undefined
      : { url: imageUrl, bounds: placed.bounds };
  const drawnInput = shown.some((set) => set.role === "input" && set.shapes.length > 0);
  const plotted =
    image !== undefined || shown.some((set) => set.role === "result" && set.shapes.length > 0);

  return (
    <aside className="map-pane" aria-label="Map">
      <MapView
        onAvailable={onAvailable}
        geometry={geometry}
        shown={shown}
        image={image}
        onResultClick={(index) => {
          if (results !== undefined) setPicked({ results, index });
        }}
        draw={{
          active: field !== undefined && control !== undefined,
          value: toBbox(current),
          onChange: (bbox) => {
            if (field === undefined || control === undefined) return;
            if (bbox === undefined) {
              setValue(field.id, undefined);
              return;
            }
            const crs =
              currentCrs !== undefined && isDrawableCrs(currentCrs)
                ? currentCrs
                : drawableCrs(control.crs);
            if (crs === undefined) return;
            const value: BboxValue = { coordinates: [...bbox], crs };
            setValue(field.id, value);
          },
        }}
      />
      {field !== undefined && control !== undefined && (
        <p className="map-hint" role="status">
          Drawing “{field.title}”: drag a rectangle on the map. Drag it or its corners to adjust.
        </p>
      )}
      {(drawnInput || plotted) && (
        <p className="map-hint map-legend" role="status" data-testid="map-legend">
          {plotted && (
            <span>
              {image === undefined ? (
                <>
                  <span className="swatch swatch-result" aria-hidden="true" /> The result
                </>
              ) : (
                <>The result’s image</>
              )}
            </span>
          )}
          {plotted && drawnInput && " beside "}
          {drawnInput && (
            <span>
              <span className="swatch swatch-input" aria-hidden="true" />{" "}
              {state.stage === "process"
                ? "The input, not yet sent"
                : plotted
                  ? "the input you sent"
                  : "The input you sent"}
            </span>
          )}
          .
        </p>
      )}
      {selected === undefined ? (
        plotted &&
        image === undefined && (
          <p className="map-overlay" data-testid="feature-hint">
            Click a result shape to see its properties.
          </p>
        )
      ) : (
        <FeatureProperties
          feature={selected}
          onClose={() => {
            setPicked(undefined);
          }}
        />
      )}
    </aside>
  );
}
