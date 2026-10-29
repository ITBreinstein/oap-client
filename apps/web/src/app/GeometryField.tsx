/**
 * A GeoJSON input: draw it on the map, load it from a file, or type it.
 *
 * All three end in the same place — GeoJSON text in the field, in the shape
 * the plan says the input takes (a bare geometry, a Feature or a
 * FeatureCollection, of its geometry types). The encoder wraps it for the wire;
 * nothing here knows about `{ "value": … }`.
 *
 * The file reader is Sam's (see `forms/geojson.ts`): it refuses a file in RD
 * New rather than reading its metres as degrees.
 */

import { useContext, useEffect, useId, useMemo, useState } from "react";
import { isGeoJsonText, type GeoJsonText } from "../forms/encode.js";
import { describeLoad, readGeoJson } from "../forms/geojson.js";
import { drawableTypes, holdsSeveral, toGeoJson } from "../forms/geometry.js";
import type { GeometryControl } from "../forms/plan.js";
import { refuseSize } from "../forms/upload.js";
import { DrawContext } from "./draw.js";
import { tooManyToEditMessage, useTooManyToEdit } from "./map-limits.js";
import type { ControlProps } from "./FormFields.js";
import { CopyField } from "./CopyButton.js";
import { formatJsonText } from "./json-text.js";
import { JsonTroubleNote } from "./JsonTroubleNote.js";
import { sizeOfGeoJsonText } from "./shape-size.js";
import { useUpdated } from "./variant.js";

const SINGULAR = { Point: "point", LineString: "line", Polygon: "area" } as const;
const PLURAL = { Point: "points", LineString: "lines", Polygon: "areas" } as const;

function either(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} or ${String(words.at(-1))}`;
}

function describeTarget(control: GeometryControl): string {
  const types = drawableTypes(control);
  if (types.length === 0) return "No shape this client can draw: enter the GeoJSON yourself.";
  const wrapper =
    control.wrapper === "feature-collection"
      ? "a FeatureCollection"
      : control.wrapper === "feature"
        ? "a Feature"
        : "a geometry";
  return holdsSeveral(control)
    ? `One or more ${either(types.map((type) => PLURAL[type]))}, sent as ${wrapper}.`
    : `One ${either(types.map((type) => SINGULAR[type]))}, sent as ${wrapper}.`;
}

export function GeometryField(props: ControlProps<GeometryControl>) {
  const { control, value, onChange, inputId, row, label } = props;
  // STYLE TRIAL: the updated Instrument lays GeoJSON out with tabs.
  const updated = useUpdated();
  const draw = useContext(DrawContext);
  const base = useId();
  const [message, setMessage] = useState<string | undefined>();
  const text = isGeoJsonText(value) ? value.geojson : "";
  const drawing = inputId !== undefined && draw.fieldId === inputId && draw.row === row;
  // In a repeatable field, each row's controls say which row they are for, in
  // their name: the visible words first, so the name still holds what is seen.
  const named = (words: string) =>
    row === undefined ? undefined : `${words}, value ${String(row + 1)}`;
  const canDraw = inputId !== undefined && draw.available && drawableTypes(control).length > 0;
  // An area input can take the map's view as its area (#18).
  const canView =
    inputId !== undefined && draw.available && drawableTypes(control).includes("Polygon");
  // A oneOf of GeoJSON among other formats (#G2b): the field says they exist.
  const others = control.otherFormats ?? [];
  const tooMany = useTooManyToEdit(text);
  const size = useMemo(() => sizeOfGeoJsonText(text), [text]);
  // A value too large to edit — loaded or pasted while drawing — ends drawing.
  useEffect(() => {
    if (drawing && tooMany !== undefined) draw.stop();
  }, [drawing, tooMany, draw]);

  const set = (geojson: string) => {
    const next: GeoJsonText = { geojson };
    onChange(geojson.trim() === "" ? undefined : next);
  };

  return (
    <div className="geometry">
      <p className="help">{describeTarget(control)}</p>
      {others.length > 0 && (
        <p className="help" data-testid="other-formats">
          The service also accepts this input as{" "}
          {others.map((format, index) => (
            <span key={format}>
              {index === 0 ? "" : index === others.length - 1 ? " or " : ", "}
              <code>{format}</code>
            </span>
          ))}
          . The page sends GeoJSON, the one format the map can make.
        </p>
      )}
      <p>
        <label htmlFor={`${base}-geojson`}>GeoJSON</label>
        <CopyField text={text} name={`Copy ${label}`} multiline>
          <textarea
            id={`${base}-geojson`}
            aria-label={named("GeoJSON")}
            className="code"
            aria-invalid={props.invalid === true ? true : undefined}
            aria-describedby={props.boxTrouble === undefined ? undefined : `${props.id}-error`}
            rows={5}
            spellCheck={false}
            value={text}
            placeholder='{ "type": "Polygon", "coordinates": … }'
            onChange={(event) => {
              setMessage(undefined);
              set(event.target.value);
            }}
            onBlur={() => {
              const laidOut = updated ? formatJsonText(text) : undefined;
              if (laidOut !== undefined && laidOut !== text) set(laidOut);
            }}
          />
        </CopyField>
      </p>
      {props.boxTrouble !== undefined && (
        <JsonTroubleNote id={`${props.id}-error`} trouble={props.boxTrouble} />
      )}
      {/* How big it is, to check a process's limit against (#15): while drawing, and after. */}
      {size !== undefined && (
        <p className="help shape-size" data-testid="shape-size">
          {size}
        </p>
      )}
      <p>
        <label htmlFor={`${base}-file`}>Or load a GeoJSON file</label>
        <input
          id={`${base}-file`}
          aria-label={named("Or load a GeoJSON file")}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          onChange={(event) => {
            const picker = event.currentTarget;
            const file = picker.files?.[0];
            // Emptied, so picking the same file again is a change again.
            picker.value = "";
            if (file === undefined) return;
            // Refused unread: reading it is what would freeze the page.
            const refused = refuseSize(file.size);
            if (refused !== undefined) {
              setMessage(refused);
              return;
            }
            void (async () => {
              let content: string;
              try {
                content = await file.text();
              } catch {
                setMessage("That file could not be read, so the value was not changed.");
                return;
              }
              // Whatever goes wrong below, the field keeps the value it had.
              const read = readGeoJson(content);
              if (!read.ok) {
                setMessage(read.message);
                return;
              }
              const shaped = toGeoJson(control, read.shapes);
              setMessage(
                shaped.geojson === undefined
                  ? `Nothing in that file fits this input. ${describeLoad(0, shaped.ignored)}`
                  : describeLoad(shaped.used, shaped.ignored),
              );
              if (shaped.geojson !== undefined) set(JSON.stringify(shaped.geojson));
            })();
          }}
        />
      </p>
      {message !== undefined && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {canDraw && tooMany !== undefined && (
        <p id={`${base}-too-many`} className="hint" data-testid="too-many-to-edit">
          {tooManyToEditMessage(tooMany)}
        </p>
      )}
      <p className="actions">
        {canDraw && (
          <button
            type="button"
            className={drawing ? "" : "secondary"}
            aria-pressed={drawing}
            aria-label={named(drawing ? "Stop drawing" : "Draw on the map")}
            data-row={row}
            disabled={tooMany !== undefined}
            aria-describedby={tooMany === undefined ? undefined : `${base}-too-many`}
            onClick={() => {
              if (drawing) draw.stop();
              else draw.start(inputId, row);
            }}
          >
            {drawing ? "Stop drawing" : "Draw on the map"}
          </button>
        )}
        {canView && (
          <button
            type="button"
            className="secondary"
            aria-label={named("Use the current map view")}
            onClick={() => {
              const view = draw.currentView?.();
              if (view === undefined) return;
              const shaped = toGeoJson(control, [extentPolygon(view)]);
              setMessage(undefined);
              if (shaped.geojson !== undefined) {
                set(JSON.stringify(shaped.geojson, null, updated ? "\t" : undefined));
              }
            }}
          >
            Use the current map view
          </button>
        )}
        <button
          type="button"
          className="secondary"
          aria-label={named("Clear")}
          onClick={() => {
            setMessage(undefined);
            set("");
          }}
        >
          Clear
        </button>
      </p>
      {/* The drawing tools, right after the Draw button in the tab order (#18). */}
      {canDraw && (
        <p className="help draw-hint">
          Drawing needs a mouse or touch. You can also paste GeoJSON or use the current map view.
        </p>
      )}
    </div>
  );
}

/** A view, west, south, east, north, as the area it covers. */
function extentPolygon([west, south, east, north]: readonly [number, number, number, number]) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}
