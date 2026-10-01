/**
 * A bounding box: typed coordinates, a CRS, and — where a box drawn on the map
 * can honestly be sent — "Draw on the map" (T9).
 *
 * Coordinates are always held longitude-first, west, south, east, north, and
 * labelled that way for a geographic CRS: the encoder owns the wire's axis
 * order, so a user never has to know that EPSG:4326 puts latitude first. For a
 * projected CRS (EPSG:28992 is the likely one here) they are X and Y in that
 * CRS's own units, and nothing is reprojected — the map cannot draw for it, and
 * the field says so and offers the raw JSON editor as well.
 */

import { useContext, useId, useState } from "react";
import { classifyCrs, drawableCrs, isDrawableCrs, typedBboxCrs } from "../forms/crs.js";
import { isRawJson, type BboxValue } from "../forms/encode.js";
import type { BboxControl } from "../forms/plan.js";
import { DrawContext } from "./draw.js";
import type { ControlProps } from "./FormFields.js";

const GEOGRAPHIC_2D = [
  "West (minimum longitude)",
  "South (minimum latitude)",
  "East (maximum longitude)",
  "North (maximum latitude)",
];
const GEOGRAPHIC_3D = [
  "West (minimum longitude)",
  "South (minimum latitude)",
  "Minimum height",
  "East (maximum longitude)",
  "North (maximum latitude)",
  "Maximum height",
];
const PROJECTED_2D = ["Minimum X", "Minimum Y", "Maximum X", "Maximum Y"];
const PROJECTED_3D = ["Minimum X", "Minimum Y", "Minimum Z", "Maximum X", "Maximum Y", "Maximum Z"];

function isBboxValue(value: unknown): value is BboxValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "coordinates" in value &&
    "crs" in value &&
    Array.isArray(value.coordinates) &&
    typeof value.crs === "string"
  );
}

function format(coordinate: number | undefined): string {
  return coordinate === undefined || Number.isNaN(coordinate) ? "" : String(coordinate);
}

/** How many numbers a box in `crs` takes: six with heights, four without. */
function coordinateCount(control: BboxControl, crs: string): 4 | 6 {
  return classifyCrs(crs) === "crs84h" || !control.dimensions.includes(4) ? 6 : 4;
}

/**
 * The typed numbers laid out for another count, each kept in its place: two
 * empty heights added after south and north, or the two heights dropped.
 * [W, S, E, N] ⇄ [W, S, minimum height, E, N, maximum height].
 */
function relayout(texts: readonly string[], count: number): string[] {
  const at = (index: number) => texts[index] ?? "";
  if (texts.length === 4 && count === 6) return [at(0), at(1), "", at(2), at(3), ""];
  if (texts.length === 6 && count === 4) return [at(0), at(1), at(3), at(4)];
  return Array.from({ length: count }, (_, index) => at(index));
}

function crsLabel(uri: string): string {
  switch (classifyCrs(uri)) {
    case "crs84":
      return `${uri} (longitude, latitude)`;
    case "epsg4326":
      return `${uri} (latitude, longitude — this client swaps for you)`;
    case "crs84h":
      return `${uri} (with heights)`;
    case "other-epsg":
    case "unknown":
      return uri;
  }
}

export function BboxField(props: ControlProps<BboxControl>) {
  const { control, value, onChange, describedBy, inputId } = props;
  const draw = useContext(DrawContext);
  const base = useId();
  const box = isBboxValue(value) ? value : undefined;
  const mapCrs = control.dimensions.includes(4) ? drawableCrs(control.crs) : undefined;
  const crs = box?.crs ?? typedBboxCrs(control);
  const kind = classifyCrs(crs);
  const geographic = kind === "crs84" || kind === "epsg4326" || kind === "crs84h";
  const count = coordinateCount(control, crs);
  const labels =
    count === 4
      ? geographic
        ? GEOGRAPHIC_2D
        : PROJECTED_2D
      : geographic
        ? GEOGRAPHIC_3D
        : PROJECTED_3D;
  const drawing = inputId !== undefined && draw.fieldId === inputId;
  const canDraw = inputId !== undefined && draw.available && mapCrs !== undefined && count === 4;

  // The typed fields keep what was typed, "5." included; the value is derived
  // from them. A box drawn on the map arrives as a new value instead, and its
  // numbers replace the typed ones — adjusted during render, as React
  // recommends, rather than in an effect that would render twice.
  const coordinates = box?.coordinates ?? [];
  const [texts, setTexts] = useState<string[]>(() =>
    Array.from({ length: count }, (_, index) => format(coordinates[index])),
  );
  /** Said once, when starting to draw cleared numbers typed in another CRS (W21). */
  const [notice, setNotice] = useState<string | undefined>();
  // A CRS set from outside with a different count: the typed numbers follow it.
  if (texts.length !== count) setTexts(relayout(texts, count));
  const drawnKey = JSON.stringify(coordinates);
  const [shown, setShown] = useState(drawnKey);
  if (shown !== drawnKey) {
    setShown(drawnKey);
    const typed = texts.map((text) => (text.trim() === "" ? Number.NaN : Number(text)));
    const same =
      coordinates.length === typed.length &&
      coordinates.every((entry, index) => Object.is(entry, typed[index]));
    if (!same && coordinates.length > 0) {
      setTexts(Array.from({ length: count }, (_, index) => format(coordinates[index])));
    }
  }

  const emit = (nextTexts: readonly string[], nextCrs: string) => {
    setNotice(undefined);
    if (nextTexts.every((text) => text.trim() === "")) {
      // No numbers yet, but a CRS chosen is a choice, and must survive until
      // they are typed (W2). An empty box counts as not given, and is not sent.
      const empty: BboxValue = { coordinates: [], crs: nextCrs };
      onChange(empty);
      return;
    }
    onChange({
      coordinates: nextTexts.map((text) => (text.trim() === "" ? Number.NaN : Number(text))),
      crs: nextCrs,
    });
  };

  if (isRawJson(value)) {
    return (
      <div className="bbox">
        <label htmlFor={`${base}-json`}>Bounding box as JSON</label>
        <textarea
          id={`${base}-json`}
          className="code"
          rows={4}
          spellCheck={false}
          value={value.rawJson}
          aria-describedby={describedBy}
          placeholder={`{ "bbox": [minX, minY, maxX, maxY], "crs": "${control.defaultCrs}" }`}
          onChange={(event) => {
            onChange({ rawJson: event.target.value });
          }}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => {
            // The fields start empty: numbers typed before the JSON editor are
            // not what the value is any more (W32).
            setTexts(Array.from({ length: count }, () => ""));
            onChange(undefined);
          }}
        >
          Use coordinate fields
        </button>
      </div>
    );
  }

  return (
    <div className="bbox" aria-describedby={describedBy}>
      {control.crs.length > 1 ? (
        <p>
          <label htmlFor={`${base}-crs`}>Coordinate reference system</label>
          <select
            id={`${base}-crs`}
            value={crs}
            onChange={(event) => {
              const next = event.target.value;
              if (drawing && !isDrawableCrs(next)) draw.stop();
              // Switching between two and three dimensions moves the typed
              // numbers to their places in the other layout (W20).
              const nextTexts = relayout(texts, coordinateCount(control, next));
              setTexts(nextTexts);
              emit(nextTexts, next);
            }}
          >
            {control.crs.map((uri) => (
              <option key={uri} value={uri}>
                {crsLabel(uri)}
              </option>
            ))}
          </select>
        </p>
      ) : (
        <p className="help">Coordinate reference system: {crsLabel(crs)}</p>
      )}

      {mapCrs === undefined && (
        <p className="hint">
          This input accepts only {control.crs.join(", ")}. A box drawn on the map cannot be sent in
          that system without reprojecting, which this client does not do: type the coordinates in
          its own units, or enter the whole value as JSON.
        </p>
      )}

      <div className="coordinates">
        {labels.map((text, index) => (
          <p key={text}>
            <label htmlFor={`${base}-c${String(index)}`}>{text}</label>
            <input
              id={`${base}-c${String(index)}`}
              type="text"
              inputMode="decimal"
              value={texts[index] ?? ""}
              onChange={(event) => {
                const next = texts.map((entry, at) => (at === index ? event.target.value : entry));
                setTexts(next);
                emit(next, crs);
              }}
            />
          </p>
        ))}
      </div>

      {notice !== undefined && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}

      <p className="actions">
        {canDraw && (
          <button
            type="button"
            className={drawing ? "" : "secondary"}
            aria-pressed={drawing}
            onClick={() => {
              if (drawing) {
                draw.stop();
                return;
              }
              if (!isDrawableCrs(crs)) {
                // The map draws in its own CRS, and numbers typed in this one
                // are not relabelled as though they were in that one (W21).
                // The CRS stays as chosen until a box is drawn.
                const typed = texts.some((text) => text.trim() !== "");
                const empty = Array.from({ length: count }, () => "");
                setTexts(empty);
                emit(empty, crs);
                if (typed) {
                  setNotice(
                    `The numbers typed in ${crs} were cleared: a box drawn on the map is in ${mapCrs}, and this client does not reproject.`,
                  );
                }
              }
              draw.start(inputId);
            }}
          >
            {drawing ? "Stop drawing" : "Draw on the map"}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setTexts(Array.from({ length: count }, () => ""));
            onChange(undefined);
          }}
        >
          Clear
        </button>
        {mapCrs === undefined && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              onChange({ rawJson: "" });
            }}
          >
            Enter as JSON
          </button>
        )}
      </p>
    </div>
  );
}
