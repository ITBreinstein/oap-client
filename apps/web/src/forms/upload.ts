/**
 * Checks on a file the user picked for an input: its size, before it is read,
 * and whether a file for a JSON-object value holds JSON at all.
 *
 * The size is checked from `File.size`, which costs nothing. Checking the text
 * after reading it — as `readGeoJson` still does, for typed text — is too late
 * for a file: a few hundred megabytes read into a string freezes the tab before
 * any check can run.
 *
 * Pure functions, no DOM: the fields call them with a file's size and text.
 */

import { MAX_FILE_BYTES } from "./geojson.js";
import { isJsonObject } from "./json.js";

/** The largest file an input will read. The same limit a GeoJSON file has. */
export const MAX_UPLOAD_BYTES: number = MAX_FILE_BYTES;

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a file of `bytes` is refused unread, or undefined when it may be read. */
export function refuseSize(bytes: number, limit: number = MAX_UPLOAD_BYTES): string | undefined {
  return bytes > limit
    ? `That file is ${megabytes(bytes)}. This page reads files up to ${megabytes(limit)}, so it was not opened.`
    : undefined;
}

/**
 * Why `text` cannot be a JSON-object value, or undefined when it can. A value
 * that is refused is not used: the field keeps what it held.
 */
export function refuseJsonObject(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "That file is not valid JSON, so the value was not changed.";
  }
  return isJsonObject(parsed)
    ? undefined
    : "That file is JSON, but not a JSON object, so the value was not changed.";
}
