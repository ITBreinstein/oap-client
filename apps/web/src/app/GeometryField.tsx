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

import { useContext, useId, useState } from "react";
import { isGeoJsonText, type GeoJsonText } from "../forms/encode.js";
import { describeLoad, readGeoJson } from "../forms/geojson.js";
import { drawableTypes, holdsSeveral, toGeoJson } from "../forms/geometry.js";
import type { GeometryControl } from "../forms/plan.js";
import { DrawContext } from "./draw.js";
import type { ControlProps } from "./FormFields.js";

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
  const { control, value, onChange, describedBy, inputId } = props;
  const draw = useContext(DrawContext);
  const base = useId();
  const [message, setMessage] = useState<string | undefined>();
  const text = isGeoJsonText(value) ? value.geojson : "";
  const drawing = inputId !== undefined && draw.fieldId === inputId;
  const canDraw = inputId !== undefined && draw.available && drawableTypes(control).length > 0;

  const set = (geojson: string) => {
    const next: GeoJsonText = { geojson };
    onChange(geojson.trim() === "" ? undefined : next);
  };

  return (
    <div className="geometry" aria-describedby={describedBy}>
      <p className="help">{describeTarget(control)}</p>
      <p>
        <label htmlFor={`${base}-geojson`}>GeoJSON</label>
        <textarea
          id={`${base}-geojson`}
          className="code"
          rows={5}
          spellCheck={false}
          value={text}
          placeholder='{ "type": "Polygon", "coordinates": … }'
          onChange={(event) => {
            setMessage(undefined);
            set(event.target.value);
          }}
        />
      </p>
      <p>
        <label htmlFor={`${base}-file`}>Or load a GeoJSON file</label>
        <input
          id={`${base}-file`}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file === undefined) return;
            void file.text().then((content) => {
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
            });
          }}
        />
      </p>
      {message !== undefined && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      <p className="actions">
        {canDraw && (
          <button
            type="button"
            className={drawing ? "" : "secondary"}
            aria-pressed={drawing}
            onClick={() => {
              if (drawing) draw.stop();
              else draw.start(inputId);
            }}
          >
            {drawing ? "Stop drawing" : "Draw on the map"}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setMessage(undefined);
            set("");
          }}
        >
          Clear
        </button>
      </p>
    </div>
  );
}
