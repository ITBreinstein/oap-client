/**
 * A result that is one plain value (#27): a string, a number or a boolean,
 * directly or as `{ "id": …, "value": … }`, as pygeoapi's Hello World
 * answers. The updated Instrument shows it large and plain, its JSON folded
 * beneath. A string of more than a line or two is not plain: it stays JSON.
 */

/** The most characters a string may have and still be shown large. */
export const PLAIN_MAX_LENGTH = 280;

export type PlainValue = string | number | boolean;

function plain(value: unknown): PlainValue | undefined {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string" && value.length <= PLAIN_MAX_LENGTH && !value.includes("\n")) {
    return value;
  }
  return undefined;
}

/** The plain value a JSON result is, or holds as its only `value`; undefined otherwise. */
export function plainValue(value: unknown): PlainValue | undefined {
  const direct = plain(value);
  if (direct !== undefined) return direct;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (!keys.includes("value") || !keys.every((key) => key === "id" || key === "value")) {
    return undefined;
  }
  return plain(Reflect.get(value, "value"));
}
