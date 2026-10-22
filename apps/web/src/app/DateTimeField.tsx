/**
 * A `format: date-time` input (#12): a date, a time and an offset from UTC,
 * made into the RFC 3339 date-time the input is sent as. The offset starts
 * as this browser's time zone's at that date and time (so summer and winter
 * differ), until one is chosen. "Type it instead" gives the plain text box,
 * for a value the fields can't hold or one pasted whole; what is typed there
 * is checked against RFC 3339 before it is sent (`forms/validate.ts`).
 *
 * The value is the date-time text, or nothing until the date and the time
 * are both there. A value set from outside (a form brought back, or
 * cleared) is shown in the fields when they can hold it, and typed when
 * they can't.
 */

import { useId, useMemo, useState } from "react";
import {
  browserTimeZone,
  composeRfc3339,
  formatOffset,
  OFFSETS,
  offsetAt,
  offsetForLocal,
  splitRfc3339,
} from "../forms/date-time.js";
import type { TextControl } from "../forms/plan.js";
import type { ControlProps } from "./FormFields.js";

interface Parts {
  readonly date: string;
  readonly time: string;
  /** Chosen by the user; until then, the browser's offset at that date and time. */
  readonly offset: string | undefined;
}

const EMPTY: Parts = { date: "", time: "", offset: undefined };

function partsOf(text: string): Parts | undefined {
  if (text.trim() === "") return EMPTY;
  return splitRfc3339(text);
}

export function DateTimeField(props: ControlProps<TextControl>) {
  const { id, value, describedBy, invalid, onChange } = props;
  const base = useId();
  const zone = useMemo(() => browserTimeZone(), []);
  // When the field was first shown: the offset it offers before a date is set.
  const [shownAt] = useState(() => Date.now());
  const text = typeof value === "string" ? value : "";
  const [parts, setParts] = useState<Parts>(() => partsOf(text) ?? EMPTY);
  const [typing, setTyping] = useState(() => partsOf(text) === undefined);
  // The last value this field gave: anything else came from outside, and
  // the fields follow it, adjusted while rendering as React recommends.
  const [given, setGiven] = useState(text);
  if (given !== text) {
    setGiven(text);
    const outside = partsOf(text);
    if (outside === undefined) setTyping(true);
    else setParts(outside);
  }

  const offset =
    parts.offset ??
    formatOffset(
      parts.date !== "" && parts.time !== ""
        ? offsetForLocal(parts.date, parts.time, zone)
        : offsetAt(shownAt, zone),
    );

  const give = (next: Parts) => {
    setParts(next);
    const composed = composeRfc3339({
      date: next.date,
      time: next.time,
      offset:
        next.offset ??
        (next.date !== "" && next.time !== ""
          ? formatOffset(offsetForLocal(next.date, next.time, zone))
          : ""),
    });
    setGiven(composed ?? "");
    onChange(composed);
  };

  const common = {
    "aria-describedby": describedBy,
    "aria-invalid": invalid === true ? true : undefined,
  };

  if (typing) {
    return (
      <div className="date-time">
        <input
          {...common}
          id={id}
          type="text"
          spellCheck={false}
          placeholder="2026-10-21T14:30:00+02:00"
          value={text}
          onChange={(event) => {
            setGiven(event.target.value);
            onChange(event.target.value);
          }}
        />
        <p className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const typed = partsOf(text);
              if (typed !== undefined) setParts(typed);
              else {
                // What was typed can't be shown in the fields: they start empty.
                setParts(EMPTY);
                setGiven("");
                onChange(undefined);
              }
              setTyping(false);
            }}
          >
            Use the date and time fields
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="date-time">
      <div className="date-time-parts">
        <p>
          <label htmlFor={id} className="date-time-label">
            Date
          </label>
          <input
            {...common}
            id={id}
            type="date"
            value={parts.date}
            onChange={(event) => {
              give({ ...parts, date: event.target.value });
            }}
          />
        </p>
        <p>
          <label htmlFor={`${base}-time`} className="date-time-label">
            Time
          </label>
          <input
            {...common}
            id={`${base}-time`}
            type="time"
            value={parts.time}
            onChange={(event) => {
              give({ ...parts, time: event.target.value });
            }}
          />
        </p>
        <p>
          <label htmlFor={`${base}-offset`} className="date-time-label">
            Offset from UTC
          </label>
          <select
            id={`${base}-offset`}
            aria-describedby={describedBy}
            value={offset}
            onChange={(event) => {
              give({ ...parts, offset: event.target.value });
            }}
          >
            {OFFSETS.map((each) => (
              <option key={each} value={each}>
                UTC{each === "+00:00" ? "" : each}
              </option>
            ))}
          </select>
        </p>
      </div>
      <p className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setTyping(true);
          }}
        >
          Type it instead
        </button>
      </p>
    </div>
  );
}
