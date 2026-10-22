/**
 * #12: RFC 3339 date-times from a date, a time and an offset, and checked as
 * typed; the offset a date and time take in Europe/Amsterdam, around the
 * clock changes.
 */

import { describe, expect, it } from "vitest";
import {
  composeRfc3339,
  formatOffset,
  isRfc3339,
  OFFSETS,
  offsetAt,
  offsetForLocal,
  splitRfc3339,
} from "../../src/forms/date-time.js";

const AMSTERDAM = "Europe/Amsterdam";

describe("isRfc3339", () => {
  it("takes a date-time with its offset, or Z, with or without a fraction", () => {
    for (const text of [
      "2026-10-21T14:30:00+02:00",
      "2026-10-21T12:30:00Z",
      "2026-10-21t12:30:00z",
      "2026-10-21T14:30:00.250+02:00",
      "2026-12-31T23:59:60Z",
      "2028-02-29T00:00:00-03:30",
    ]) {
      expect(isRfc3339(text), text).toBe(true);
    }
  });

  it("refuses what a visitor may type instead", () => {
    for (const text of [
      "21-10-2026 14:30",
      "2026-10-21 14:30",
      "2026-10-21T14:30+02:00",
      "2026-10-21T14:30:00",
      "2026-10-21",
      "2026-13-01T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "2026-10-21T24:00:00Z",
      "2026-10-21T14:30:00+2:00",
      "",
    ]) {
      expect(isRfc3339(text), text).toBe(false);
    }
  });
});

describe("composeRfc3339", () => {
  it("adds the seconds a time field leaves out", () => {
    expect(composeRfc3339({ date: "2026-10-21", time: "14:30", offset: "+02:00" })).toBe(
      "2026-10-21T14:30:00+02:00",
    );
  });

  it("keeps seconds that are there", () => {
    expect(composeRfc3339({ date: "2026-10-21", time: "14:30:15", offset: "-03:30" })).toBe(
      "2026-10-21T14:30:15-03:30",
    );
  });

  it("is nothing until the date, the time and the offset are all there", () => {
    expect(composeRfc3339({ date: "2026-10-21", time: "", offset: "+02:00" })).toBeUndefined();
    expect(composeRfc3339({ date: "", time: "14:30", offset: "+02:00" })).toBeUndefined();
  });
});

describe("splitRfc3339", () => {
  it("gives a date-time's parts back, as the fields take them", () => {
    expect(splitRfc3339("2026-10-21T14:30:00+02:00")).toEqual({
      date: "2026-10-21",
      time: "14:30",
      offset: "+02:00",
    });
    expect(splitRfc3339("2026-10-21T14:30:15.5Z")).toEqual({
      date: "2026-10-21",
      time: "14:30:15.5",
      offset: "+00:00",
    });
  });

  it("composes back to the same instant", () => {
    const parts = splitRfc3339("2026-03-29T03:15:00+02:00");
    expect(parts === undefined ? undefined : composeRfc3339(parts)).toBe(
      "2026-03-29T03:15:00+02:00",
    );
  });

  it("has no parts for anything else", () => {
    expect(splitRfc3339("21-10-2026 14:30")).toBeUndefined();
  });
});

describe("offsets", () => {
  it("are written as RFC 3339 writes them", () => {
    expect(formatOffset(120)).toBe("+02:00");
    expect(formatOffset(-210)).toBe("-03:30");
    expect(formatOffset(0)).toBe("+00:00");
  });

  it("run from UTC−12:00 to UTC+14:00 by quarters, Nepal's included", () => {
    expect(OFFSETS[0]).toBe("-12:00");
    expect(OFFSETS.at(-1)).toBe("+14:00");
    expect(OFFSETS).toContain("+05:45");
    expect(OFFSETS).toContain("+00:00");
  });

  it("are read off a time zone at an instant", () => {
    expect(offsetAt(Date.UTC(2026, 6, 1), AMSTERDAM)).toBe(120);
    expect(offsetAt(Date.UTC(2026, 0, 1), AMSTERDAM)).toBe(60);
    expect(offsetAt(Date.UTC(2026, 0, 1), "UTC")).toBe(0);
    expect(offsetAt(Date.UTC(2026, 0, 1), "America/St_Johns")).toBe(-210);
  });
});

describe("offsetForLocal in Europe/Amsterdam, around the clock changes of 2026", () => {
  it("is CET in winter and CEST in summer", () => {
    expect(offsetForLocal("2026-01-15", "12:00", AMSTERDAM)).toBe(60);
    expect(offsetForLocal("2026-07-15", "12:00", AMSTERDAM)).toBe(120);
  });

  it("changes at 02:00 on 29 March, when the clocks go forward", () => {
    expect(offsetForLocal("2026-03-29", "01:59", AMSTERDAM)).toBe(60);
    expect(offsetForLocal("2026-03-29", "03:00", AMSTERDAM)).toBe(120);
  });

  it("gives 02:30 on 29 March, which never happens, the offset from before", () => {
    expect(offsetForLocal("2026-03-29", "02:30", AMSTERDAM)).toBe(60);
  });

  it("changes at 03:00 on 25 October, when the clocks go back", () => {
    expect(offsetForLocal("2026-10-25", "01:59", AMSTERDAM)).toBe(120);
    expect(offsetForLocal("2026-10-25", "03:00", AMSTERDAM)).toBe(60);
  });

  it("gives 02:30 on 25 October, which happens twice, its first: CEST", () => {
    expect(offsetForLocal("2026-10-25", "02:30", AMSTERDAM)).toBe(120);
  });

  it("composes the date-times either side of a change", () => {
    const at = (date: string, time: string) =>
      composeRfc3339({ date, time, offset: formatOffset(offsetForLocal(date, time, AMSTERDAM)) });
    expect(at("2026-03-29", "01:30")).toBe("2026-03-29T01:30:00+01:00");
    expect(at("2026-03-29", "03:30")).toBe("2026-03-29T03:30:00+02:00");
    expect(at("2026-10-25", "01:30")).toBe("2026-10-25T01:30:00+02:00");
    expect(at("2026-10-25", "03:30")).toBe("2026-10-25T03:30:00+01:00");
  });
});
