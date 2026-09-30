/**
 * A complex input offered in alternative encodings (T3): pick the format, then
 * give the value inline — typed, or read from a file — or as a URL the server
 * fetches itself.
 *
 * A file is read the way the chosen format says it travels: as base64 for a
 * `contentEncoding: base64` branch (3 574 of ZOO's branches are), as text for
 * everything else. The brief's "a file read as text" would have sent a PNG as
 * mangled UTF-8; the branch's own encoding decides instead.
 *
 * A JSON-object format can also be drawn on the map, as a GeoJSON
 * FeatureCollection. The description says only "an object", so the user
 * decides whether it is geometry — which is how real services declare it: ZOO's
 * Buffer and SAGA's polygon tools take GML or "an object".
 */

import { useContext, useId, useState } from "react";
import type { ComplexValue } from "../forms/encode.js";
import type { ComplexControl } from "../forms/plan.js";
import { refuseJsonObject, refuseSize } from "../forms/upload.js";
import { DrawContext } from "./draw.js";
import type { ControlProps } from "./FormFields.js";

function asComplex(value: unknown): ComplexValue {
  if (typeof value === "object" && value !== null && "format" in value) {
    const record: Record<string, unknown> = { ...value };
    const format = record["format"];
    const text = record["value"];
    const href = record["href"];
    return {
      format: typeof format === "number" ? format : 0,
      ...(typeof text === "string" ? { value: text } : {}),
      ...(typeof href === "string" ? { href } : {}),
    };
  }
  return { format: 0 };
}

function readFile(file: File, base64: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("the file could not be read"));
    };
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      // A data URL: everything after the first comma is the base64 payload.
      resolve(base64 ? result.slice(result.indexOf(",") + 1) : result);
    };
    if (base64) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

export function ComplexField(props: ControlProps<ComplexControl>) {
  const { control, value, onChange, describedBy, inputId } = props;
  const draw = useContext(DrawContext);
  const base = useId();
  const [message, setMessage] = useState<string | undefined>();
  const current = asComplex(value);
  const format = control.formats[current.format] ?? control.formats[0];
  const byReference = current.href !== undefined;
  const base64 = format?.encoding?.toLowerCase() === "base64";
  const drawing = inputId !== undefined && draw.fieldId === inputId;
  const canDraw =
    inputId !== undefined && draw.available && format?.object === true && !byReference;

  return (
    <div className="complex" aria-describedby={describedBy}>
      {control.formats.length > 1 ? (
        <p>
          <label htmlFor={`${base}-format`}>Format</label>
          <select
            id={`${base}-format`}
            value={String(current.format)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (drawing && control.formats[next]?.object !== true) draw.stop();
              onChange({ ...current, format: next });
            }}
          >
            {control.formats.map((entry, index) => (
              <option key={`${entry.label}-${String(index)}`} value={String(index)}>
                {entry.label}
              </option>
            ))}
          </select>
        </p>
      ) : (
        <p className="help">Format: {format?.label}</p>
      )}
      {format?.contentSchema !== undefined && (
        <p className="help">Schema: {format.contentSchema}</p>
      )}

      {control.byReference && (
        <div className="choices" role="radiogroup" aria-label="How to give the value">
          <label className="choice">
            <input
              type="radio"
              name={`${base}-source`}
              checked={!byReference}
              onChange={() => {
                onChange({ format: current.format, value: "" });
              }}
            />{" "}
            Enter the value
          </label>
          <label className="choice">
            <input
              type="radio"
              name={`${base}-source`}
              checked={byReference}
              onChange={() => {
                if (drawing) draw.stop();
                onChange({ format: current.format, href: "" });
              }}
            />{" "}
            Give a URL for the server to fetch
          </label>
        </div>
      )}

      {byReference ? (
        <p>
          <label htmlFor={`${base}-href`}>URL</label>
          <input
            id={`${base}-href`}
            type="url"
            value={current.href ?? ""}
            placeholder="https://"
            onChange={(event) => {
              onChange({ format: current.format, href: event.target.value });
            }}
          />
        </p>
      ) : (
        <>
          <p>
            <label htmlFor={`${base}-value`}>
              Value{format?.object === true ? " (JSON)" : base64 ? " (base64)" : ""}
            </label>
            <textarea
              id={`${base}-value`}
              className="code"
              rows={5}
              spellCheck={false}
              value={current.value ?? ""}
              onChange={(event) => {
                setMessage(undefined);
                onChange({ format: current.format, value: event.target.value });
              }}
            />
          </p>
          <p>
            <label htmlFor={`${base}-file`}>Or read the value from a file</label>
            <input
              id={`${base}-file`}
              type="file"
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
                const { format: chosen } = current;
                const object = format?.object === true;
                void (async () => {
                  let text: string;
                  try {
                    text = await readFile(file, base64);
                  } catch {
                    setMessage("That file could not be read, so the value was not changed.");
                    return;
                  }
                  // A JSON-object format is sent as a parsed object: text that
                  // does not parse would reach the server as a string instead.
                  const notJson = object ? refuseJsonObject(text) : undefined;
                  if (notJson !== undefined) {
                    setMessage(notJson);
                    return;
                  }
                  setMessage(undefined);
                  onChange({ format: chosen, value: text });
                })();
              }}
            />
          </p>
          {message !== undefined && (
            <p className="hint" role="status">
              {message}
            </p>
          )}
          {canDraw && (
            <p className="actions">
              <button
                type="button"
                className={drawing ? "" : "secondary"}
                aria-pressed={drawing}
                onClick={() => {
                  if (drawing) draw.stop();
                  else draw.start(inputId);
                }}
              >
                {drawing ? "Stop drawing" : "Draw GeoJSON on the map"}
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
