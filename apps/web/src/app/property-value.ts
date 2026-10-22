/**
 * A clicked feature's property values, as the properties panel shows them
 * (#20): a web address as a link, a number with its digits grouped the Dutch
 * way from five digits on, a short list as words separated by commas (by
 * semicolons when an item has a decimal comma of its own), and anything
 * else as JSON text. Nothing is ever read as HTML.
 */

import type { ShapeOrigin } from "../forms/geojson.js";
import { isJsonObject } from "../forms/json.js";

export type ShownValue =
  | { readonly kind: "link"; readonly href: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "json"; readonly text: string };

/** At most this many items, each at most {@link SHORT_ITEM} characters, make a short list. */
export const SHORT_LIST = 10;
export const SHORT_ITEM = 40;

const NUMBER = new Intl.NumberFormat("nl-NL", {
  // Every digit the value has: a property is data, not rounded for show.
  maximumFractionDigits: 20,
  // 1923 stays 1923; 12345 is 12.345.
  useGrouping: "min2",
});

/** A number as the panel shows it: Dutch decimal comma, digits grouped from five on. */
export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** The address, when a whole value is an http or https address. */
export function webAddress(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function itemText(item: unknown): string | undefined {
  if (typeof item === "string") return item.length <= SHORT_ITEM ? item : undefined;
  if (typeof item === "number") return formatNumber(item);
  if (typeof item === "boolean") return String(item);
  return undefined;
}

export function shownValue(value: unknown): ShownValue {
  if (typeof value === "string") {
    const href = webAddress(value);
    return href === undefined ? { kind: "text", text: value } : { kind: "link", href };
  }
  if (typeof value === "number") return { kind: "text", text: formatNumber(value) };
  if (typeof value === "boolean") return { kind: "text", text: String(value) };
  if (Array.isArray(value) && value.length > 0 && value.length <= SHORT_LIST) {
    const items = value.map(itemText);
    if (items.every((item) => item !== undefined)) {
      // A decimal comma in an item would run into the commas between them.
      const between = items.some((item) => item.includes(",")) ? "; " : ", ";
      return { kind: "text", text: items.join(between) };
    }
  }
  if (value === null) return { kind: "text", text: "null" };
  return { kind: "json", text: JSON.stringify(value, null, 2) };
}

/** Whether a plotted shape has properties to show when clicked (#21). */
export function hasProperties(origin: ShapeOrigin): boolean {
  if (origin.kind === "bare-geometry") return false;
  const { properties } = origin;
  if (properties === null) return false;
  return !isJsonObject(properties) || Object.keys(properties).length > 0;
}
