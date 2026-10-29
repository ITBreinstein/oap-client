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

import { useContext, useEffect, useRef, useState } from "react";
import { classifyCrs, drawableCrs, isDrawableCrs } from "../forms/crs.js";
import { extentOfBbox } from "./shape-size.js";
import type { BboxValue } from "../forms/encode.js";
import {
  drawableTypes,
  holdsSeveral,
  shapesOfText,
  toGeoJson,
  type GeometryTarget,
} from "../forms/geometry.js";
import type { Bbox } from "../map/bbox.js";
import type { MapShape, Tool } from "../map/geometry-engine.js";
import { MapView, type CreateMap } from "../map/MapView.js";
import type { ShownShapes } from "../map/shape-layers.js";
import {
  mapImage,
  plotStatus,
  plottedFeatures,
  plottedShapes,
  positionCount,
} from "../results/plottable.js";
import type { RenderableResult } from "../results/renderable.js";
import { FeatureProperties } from "./FeatureProperties.js";
import { hasProperties } from "./property-value.js";
import { legendKind, legendNoun, shapeKinds } from "./shape-words.js";
import { PlaceSearch } from "./PlaceSearch.js";
import { useWide } from "./useWide.js";
import { fieldTexts, shapeBinding } from "./input-shapes.js";
import type { GeometryDrawProps } from "../map/useGeometryDraw.js";
import type { DrawTarget } from "./draw.js";
import { MapLimitsContext, tooManyToEdit } from "./map-limits.js";
import { useDataUrl } from "./useDataUrl.js";
import { useUpdated } from "./variant.js";
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

/** A box value in longitude and latitude as the polygon it outlines; none otherwise. */
export function boxOutline(value: unknown): MapShape[] {
  if (typeof value !== "object" || value === null || !("crs" in value)) return [];
  const crs: unknown = value.crs;
  const kind = typeof crs === "string" ? classifyCrs(crs) : "unknown";
  if (kind !== "crs84" && kind !== "epsg4326" && kind !== "crs84h") return [];
  const coordinates: unknown = "coordinates" in value ? value.coordinates : undefined;
  if (!Array.isArray(coordinates)) return [];
  const numbers = coordinates.filter((entry): entry is number => typeof entry === "number");
  if (numbers.length !== coordinates.length) return [];
  const extent = extentOfBbox(numbers);
  if (extent === undefined) return [];
  const { west, south, east, north } = extent;
  return [
    {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  ];
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
 * before it is sent. The field the map is drawing for is left out — for a
 * repeatable geometry field, only the row being drawn (`drawingRow`): the draw
 * mode shows that one itself, editable, and showing it twice would put a stale
 * copy under the one being edited.
 *
 * Derived from the workflow on every render, never stored: when another
 * process is opened its fresh values hold no geometry, and a field that is
 * gone contributes none, so the input layer empties without anything having
 * to remove it.
 *
 * An input or result with more than `maxCoordinates` positions is left off
 * ({@link leftOffTheMap} says which).
 */
export function shownFor(
  state: Workflow,
  drawing?: string,
  maxCoordinates: number = Number.POSITIVE_INFINITY,
  drawingRow?: number,
): readonly ShownShapes[] {
  if (state.stage !== "process" && state.stage !== "running" && state.stage !== "result") {
    return [];
  }
  const input = state.plan.fields.flatMap((field) => {
    const drawn = state.stage === "process" && field.id === drawing;
    if (drawn && drawingRow === undefined) return [];
    const current = Object.hasOwn(state.values, field.id) ? state.values[field.id] : undefined;
    // A box in longitude and latitude, as its outline (#19): typed, it is on
    // the map too, as a drawn one is.
    if (field.control.kind === "bbox") return boxOutline(current);
    return fieldTexts(field, current, drawn ? drawingRow : undefined).flatMap(({ text }) => {
      const shapes = shapesOfText(text);
      return positionCount(shapes) > maxCoordinates ? [] : shapes;
    });
  });
  const result = state.stage === "result" ? plottedShapes(state.results, maxCoordinates) : [];
  return [
    { role: "input", shapes: input },
    { role: "result", shapes: result },
  ];
}

/** An input or a result the map was not asked to draw, and why. */
interface LeftOff {
  readonly name: string;
  readonly positions: number;
}

/** What {@link shownFor} leaves off for having too many positions, by name. */
export function leftOffTheMap(state: Workflow, maxCoordinates: number): LeftOff[] {
  if (state.stage !== "process" && state.stage !== "running" && state.stage !== "result") {
    return [];
  }
  const inputs = state.plan.fields.flatMap((field) => {
    const current = Object.hasOwn(state.values, field.id) ? state.values[field.id] : undefined;
    return fieldTexts(field, current).flatMap(({ text, row }) => {
      const positions = positionCount(shapesOfText(text));
      const name = row === undefined ? field.title : `${field.title}, value ${String(row + 1)}`;
      return positions > maxCoordinates ? [{ name, positions }] : [];
    });
  });
  const results =
    state.stage === "result"
      ? state.results.flatMap((result) => {
          const status = plotStatus(result, maxCoordinates);
          return status.kind === "too-many"
            ? [{ name: result.outputId, positions: status.positions }]
            : [];
        })
      : [];
  return [...inputs, ...results];
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
  onViewReader,
  basemap,
}: {
  readonly state: Workflow;
  readonly draw: DrawTarget;
  readonly setValue: (id: string, value: unknown) => void;
  readonly onAvailable: (available: boolean) => void;
  /** How to read what the map shows, for "Use the current map view" (#18). */
  readonly onViewReader?:
    | ((read: (() => readonly [number, number, number, number] | undefined) | undefined) => void)
    | undefined;
  /** STYLE TRIAL: the updated Instrument's world map; PDOK's otherwise. */
  readonly basemap?: { readonly create: CreateMap; readonly label: string } | undefined;
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
  // A repeatable geometry field draws for one row at a time (`draw.row`).
  const row = field?.control.kind === "list" ? draw.row : undefined;
  const shapes = field === undefined ? undefined : shapeBinding(field, current, row);
  const drawingName =
    field === undefined
      ? ""
      : row === undefined
        ? `“${field.title}”`
        : `“${field.title}”, value ${String(row + 1)}`;
  const { maxCoordinates, maxEditableCoordinates } = useContext(MapLimitsContext);
  // STYLE TRIAL: the updated Instrument writes drawn GeoJSON laid out with tabs.
  const updated = useUpdated();
  // Never into the draw mode: Terra Draw keeps a feature per vertex and
  // redraws them all on every move. Shown read-only on the input layer
  // instead, and the field says why (map-limits.ts).
  const editable =
    shapes === undefined || tooManyToEdit(shapes.text, maxEditableCoordinates) === undefined;

  const geometry: GeometryDrawProps =
    field === undefined || shapes === undefined || !editable
      ? INACTIVE
      : {
          active: true,
          tools: toolsFor(shapes.target),
          several: holdsSeveral(shapes.target),
          // One area: drawing starts on "Add area" (#17); "Add box" stays a click away.
          startWith:
            !holdsSeveral(shapes.target) &&
            drawableTypes(shapes.target).length === 1 &&
            drawableTypes(shapes.target)[0] === "Polygon"
              ? "Polygon"
              : undefined,
          value: shapesOfText(shapes.text),
          onChange: (drawn: readonly MapShape[]) => {
            const { geojson } = toGeoJson(shapes.target, drawn);
            setValue(
              field.id,
              shapes.write(
                geojson === undefined
                  ? ""
                  : JSON.stringify(geojson, null, updated ? "\t" : undefined),
              ),
            );
          },
        };

  const shown = shownFor(
    state,
    field === undefined || !editable ? undefined : draw.fieldId,
    maxCoordinates,
    row,
  );
  const leftOff = leftOffTheMap(state, maxCoordinates);
  // A click picks a result shape by its index among the plotted ones — the
  // order `shownFor` shows them in. Held with the results it was made on, so
  // a new run, or leaving the result, drops it without anything noticing.
  const [picked, setPicked] = useState<
    | {
        readonly results: readonly RenderableResult[];
        readonly index: number;
        /** Where the properties go: the side of the map away from the click (#20). */
        readonly side: "left" | "right";
      }
    | undefined
  >();
  const results = state.stage === "result" ? state.results : undefined;
  const features = results === undefined ? [] : plottedFeatures(results, maxCoordinates);
  const selected = picked?.results === results ? features[picked?.index ?? -1] : undefined;
  // Something to show when a shape is clicked: only then does the map invite a click (#21).
  const clickable = features.some((feature) => hasProperties(feature.origin));
  // On a phone the map is below the form (#39): drawing brings it into view,
  // with Done and Clear pinned over it, and Done goes back to the field.
  const wide = useWide();
  const pane = useRef<HTMLElement>(null);
  const drawingHere = field !== undefined && !wide;
  useEffect(() => {
    if (!drawingHere) return;
    const element = pane.current;
    if (element !== null && "scrollIntoView" in element) {
      element.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, [drawingHere]);
  const done = () => {
    const id = field?.id;
    draw.stop();
    if (id === undefined) return;
    requestAnimationFrame(() => {
      const back = document.querySelector<HTMLElement>(`[data-input-id="${CSS.escape(id)}"]`);
      if (back !== null && "scrollIntoView" in back) back.scrollIntoView({ block: "center" });
      // A repeatable field has a Draw button per row: back to the one pressed.
      const button =
        row === undefined
          ? "button[aria-pressed]"
          : `button[aria-pressed][data-row="${String(row)}"]`;
      back?.querySelector<HTMLElement>(button)?.focus({ preventScroll: true });
    });
  };
  const clearDrawn = () => {
    if (field === undefined) return;
    setValue(
      field.id,
      control === undefined && shapes !== undefined ? shapes.write("") : undefined,
    );
  };

  // A place chosen in "Find a place" (#16): the map moves to it once.
  const [goTo, setGoTo] = useState<
    { readonly id: number; readonly extent: readonly [number, number, number, number] } | undefined
  >();
  const placed = state.stage === "result" ? mapImage(state.results) : undefined;
  const imageUrl = useDataUrl(placed?.blob);
  const image =
    placed === undefined || imageUrl === undefined
      ? undefined
      : { url: imageUrl, bounds: placed.bounds };
  const drawnInput = shown.some((set) => set.role === "input" && set.shapes.length > 0);
  const inputKinds = shapeKinds(
    shown.filter((set) => set.role === "input").flatMap((set) => set.shapes),
  );
  const plotted =
    image !== undefined || shown.some((set) => set.role === "result" && set.shapes.length > 0);

  return (
    <aside className="map-pane" aria-label="Map" ref={pane} data-drawing-here={drawingHere}>
      {drawingHere && (
        <div className="draw-bar" role="group" aria-label={`Drawing ${drawingName}`}>
          <span className="draw-bar-title">Drawing {drawingName}</span>
          <button type="button" className="secondary" onClick={clearDrawn}>
            Clear
          </button>
          <button type="button" onClick={done}>
            Done
          </button>
        </div>
      )}
      <PlaceSearch
        onPlace={(place) => {
          setGoTo((last) => ({ id: (last?.id ?? 0) + 1, extent: place.extent }));
        }}
      />
      <MapView
        goTo={goTo}
        createMap={basemap?.create}
        label={basemap?.label}
        onAvailable={onAvailable}
        onViewReader={onViewReader}
        focusToken={draw.focusToken}
        geometry={geometry}
        shown={shown}
        image={image}
        onResultClick={(index, at) => {
          if (results === undefined) return;
          setPicked({ results, index, side: at.x < at.width / 2 ? "right" : "left" });
        }}
        selected={selected === undefined ? undefined : picked?.index}
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
              {/* Named, and drawn, by what it holds: a point, a line, an area (#22). */}
              <span
                className="swatch swatch-input"
                data-kind={legendKind(inputKinds)}
                aria-hidden="true"
              />{" "}
              {state.stage === "process"
                ? `The ${legendNoun(inputKinds)}, not yet sent`
                : plotted
                  ? `the ${legendNoun(inputKinds)} you sent`
                  : `The ${legendNoun(inputKinds)} you sent`}
            </span>
          )}
          .
        </p>
      )}
      {leftOff.length > 0 && (
        <p className="map-hint" role="status" data-testid="map-left-off">
          Not drawn on the map, because it has more than {maxCoordinates.toLocaleString("en")}{" "}
          coordinates:{" "}
          {leftOff
            .map(({ name, positions }) => `“${name}” (${positions.toLocaleString("en")})`)
            .join(", ")}
          . {state.stage === "result" ? "A result can still be downloaded." : ""}
        </p>
      )}
      {selected === undefined ? (
        plotted &&
        image === undefined &&
        clickable && (
          <p className="map-overlay" data-testid="feature-hint">
            Click a result shape to see its properties.
          </p>
        )
      ) : (
        <FeatureProperties
          feature={selected}
          side={picked?.side}
          onClose={() => {
            setPicked(undefined);
          }}
        />
      )}
    </aside>
  );
}
