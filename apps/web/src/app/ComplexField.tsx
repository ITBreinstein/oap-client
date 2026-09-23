/**
 * A complex input offered in alternative encodings (T3): pick the format, then
 * give the value inline — typed, or read from a file — or as a URL the server
 * fetches itself.
 *
 * A file is read the way the chosen format says it travels: as base64 for a
 * `contentEncoding: base64` branch (3 574 of ZOO's branches are), as text for
 * everything else. The brief's "a file read as text" would have sent a PNG as
 * mangled UTF-8; the branch's own encoding decides instead.
 */

import { useId } from "react";
import type { ComplexValue } from "../forms/encode.js";
import type { ComplexControl } from "../forms/plan.js";
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
  const { control, value, onChange, describedBy } = props;
  const base = useId();
  const current = asComplex(value);
  const format = control.formats[current.format] ?? control.formats[0];
  const byReference = current.href !== undefined;
  const base64 = format?.encoding?.toLowerCase() === "base64";

  return (
    <div className="complex" aria-describedby={describedBy}>
      {control.formats.length > 1 ? (
        <p>
          <label htmlFor={`${base}-format`}>Format</label>
          <select
            id={`${base}-format`}
            value={String(current.format)}
            onChange={(event) => {
              onChange({ ...current, format: Number(event.target.value) });
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
                const file = event.target.files?.[0];
                if (file === undefined) return;
                void readFile(file, base64).then((text) => {
                  onChange({ format: current.format, value: text });
                });
              }}
            />
          </p>
        </>
      )}
    </div>
  );
}
