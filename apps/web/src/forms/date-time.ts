/**
 * Dates and times as RFC 3339 has them (#12): what a `format: date-time`
 * input is sent as, made from a date, a time and an offset from UTC, or
 * checked as typed.
 *
 * `2026-10-21T14:30:00+02:00`: a full date, `T`, a time with seconds (and
 * optionally a fraction), and the offset, or `Z` for UTC.
 */

const RFC_3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/;

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether text is a date-time as RFC 3339 has it, its numbers in range. */
export function isRfc3339(text: string): boolean {
  const match = RFC_3339.exec(text.trim());
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return false;
  }
  const offsetHours = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinutes = match[11] === undefined ? 0 : Number(match[11]);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysIn(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    // 60: a leap second, which RFC 3339 allows.
    second <= 60 &&
    offsetHours <= 23 &&
    offsetMinutes <= 59
  );
}

/** A date-time's parts, as a date field, a time field and an offset take them. */
export interface DateTimeParts {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:MM`, or `HH:MM:SS` when its seconds are not 0, or have a fraction. */
  readonly time: string;
  /** `+HH:MM` or `-HH:MM`; UTC is `+00:00`. */
  readonly offset: string;
}

/** The parts of an RFC 3339 date-time; undefined for anything else. */
export function splitRfc3339(text: string): DateTimeParts | undefined {
  const trimmed = text.trim();
  if (!isRfc3339(trimmed)) return undefined;
  const match = RFC_3339.exec(trimmed);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second = "00", fraction = "", zone = "Z"] = match;
  const seconds = second === "00" && fraction === "" ? "" : `:${second}${fraction}`;
  return {
    date: `${String(year)}-${String(month)}-${String(day)}`,
    time: `${String(hour)}:${String(minute)}${seconds}`,
    offset: zone.toUpperCase() === "Z" ? "+00:00" : zone,
  };
}

/**
 * The RFC 3339 date-time of a date, a time (`HH:MM` or `HH:MM:SS`, as a
 * time field gives it) and an offset: seconds added where the time has
 * none, as RFC 3339 requires them. Undefined until all three are there.
 */
export function composeRfc3339(parts: DateTimeParts): string | undefined {
  const { date, time, offset } = parts;
  if (date === "" || time === "" || offset === "") return undefined;
  const withSeconds = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const text = `${date}T${withSeconds}${offset}`;
  return isRfc3339(text) ? text : undefined;
}

/** An offset in minutes as RFC 3339 writes it: `+02:00`, `-03:30`, `+00:00`. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const whole = Math.abs(minutes);
  const hours = String(Math.floor(whole / 60)).padStart(2, "0");
  const rest = String(whole % 60).padStart(2, "0");
  return `${sign}${hours}:${rest}`;
}

/** The offsets one can choose: UTC−12:00 to UTC+14:00, every quarter of an hour. */
export const OFFSETS: readonly string[] = Array.from({ length: (14 + 12) * 4 + 1 }, (_, index) =>
  formatOffset(-12 * 60 + index * 15),
);

/** A time zone's offset from UTC at an instant, in minutes: `+120` for CEST. */
export function offsetAt(epochMs: number, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(epochMs)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{2}):?(\d{2})?$/.exec(name);
  if (match === null) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? "0");
  return match[1] === "-" ? -minutes : minutes;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A time zone's offset from UTC at a date and time on its own clocks, in
 * minutes. Where the clocks go forward, the time that never happens takes
 * the offset from before; where they go back, the hour that happens twice
 * takes its first: both as JavaScript's `Date` does.
 */
export function offsetForLocal(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const wall = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    Math.floor(second ?? 0),
  );
  // The offsets either side of any change near this time.
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const fits = (offset: number) => offsetAt(wall - offset * 60_000, timeZone) === offset;
  const fitting = [before, after].filter(fits);
  // Both fit: the hour that happens twice, its first (the larger offset).
  // Neither: the hour that never happens, with the offset from before.
  return fitting.length === 0 ? before : Math.max(...fitting);
}

/** The browser's own time zone, for the offset a date-time starts with. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
