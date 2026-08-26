/**
 * RFC 8288 `Link` header parsing.
 *
 * Only the header is handled here. OGC API - Processes puts most of its links
 * in the response *body*; those are a later concern, and this module makes no
 * attempt to model them.
 */

import { unquote } from "./media-type.js";

export interface WebLink {
  /** Resolved against the response's final URL. Falls back to `hrefRaw` if unresolvable. */
  readonly href: string;
  /** Exactly as the server sent it, relative or not. */
  readonly hrefRaw: string;
  readonly rel: string | undefined;
  readonly type: string | undefined;
  readonly title: string | undefined;
  readonly hreflang: string | undefined;
  /** Every parameter, including the four above, lowercased and unquoted. */
  readonly params: Readonly<Record<string, string>>;
}

const EMPTY_LINKS: readonly WebLink[] = Object.freeze([]);

/**
 * Splits a Link header into its entries. A comma only separates entries when it
 * is outside both `<...>` and a quoted string — URLs and titles both contain
 * commas often enough that a naive `split(",")` corrupts real headers.
 */
function splitEntries(header: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let inAngle = false;
  let quoted = false;
  let escaped = false;

  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\" && quoted) {
      escaped = true;
    } else if (quoted) {
      if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "<") {
      inAngle = true;
    } else if (ch === ">") {
      inAngle = false;
    } else if (ch === "," && !inAngle) {
      entries.push(header.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(header.slice(start));
  return entries;
}

function splitParams(rest: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\" && quoted) {
      escaped = true;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ";" && !quoted) {
      parts.push(rest.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(rest.slice(start));
  return parts;
}

/** `base` is the response's final URL; a relative href is resolved against it. */
export function parseLinkHeader(
  header: string | null | undefined,
  base: string,
): readonly WebLink[] {
  if (header === null || header === undefined || header.trim() === "") return EMPTY_LINKS;

  const links: WebLink[] = [];

  for (const entry of splitEntries(header)) {
    const open = entry.indexOf("<");
    const close = entry.indexOf(">", open + 1);
    if (open === -1 || close === -1) continue;

    const hrefRaw = entry.slice(open + 1, close).trim();
    const params: Record<string, string> = {};

    for (const part of splitParams(entry.slice(close + 1))) {
      const trimmed = part.trim();
      if (trimmed === "") continue;
      const eq = trimmed.indexOf("=");
      // A valueless parameter is legal; record it as present with an empty value.
      const name = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase();
      if (name === "") continue;
      params[name] = eq === -1 ? "" : unquote(trimmed.slice(eq + 1));
    }

    links.push({
      href: resolve(hrefRaw, base),
      hrefRaw,
      rel: params["rel"],
      type: params["type"],
      title: params["title"],
      hreflang: params["hreflang"],
      params: Object.freeze(params),
    });
  }

  return links.length === 0 ? EMPTY_LINKS : Object.freeze(links);
}

/** Resolution failures fall back to the raw value; a bad link is evidence, not an error. */
export function resolve(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
