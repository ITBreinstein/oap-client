/**
 * A raw answer with several outputs, as 1.0 defines it: `multipart/related`,
 * one part per output, each part's `Content-ID` the output's id (18-062r2
 * Requirement 29). The fallback for a service that sends one although the page
 * asked for a results document (`app/run.ts`, `responseFor`).
 *
 * Read by RFC 2046, with exactly two tolerances, each recorded on the result:
 *
 * - `lf-line-endings`: RFC 2046 §5.1.1 puts every delimiter after a CRLF, and
 *   the CRLF belongs to the delimiter. A body with no CRLF delimiter at all is
 *   read again with LF alone.
 * - `unquoted-boundary`: RFC 2045 §5.1 makes a parameter value a token or a
 *   quoted string, and a token has no tspecials, `=` among them. A boundary
 *   sent unquoted with one in it is taken as it stands, up to the next `;`.
 *
 * The Beleidsnormen API needs both. Nothing else is tolerated: a body whose
 * delimiters are not at the start of a line (ZOO, finding 0073) or that has no
 * close delimiter is not read, and the page offers it as a download.
 */

export type MultipartLeniency = "lf-line-endings" | "unquoted-boundary";

export interface MultipartPart {
  /** Header names lowercased, values as sent. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type MultipartRead =
  | {
      readonly ok: true;
      readonly parts: readonly MultipartPart[];
      readonly lenient: readonly MultipartLeniency[];
    }
  | { readonly ok: false; readonly reason: "no-boundary" | "framing" };

// RFC 2045 §5.1: a token is any CHAR except SPACE, CTLs and tspecials.
const TOKEN = /^[!#$%&'*+\-.^_`{|}~0-9A-Za-z]+$/;

/** The `boundary` parameter of a Content-Type, and whether it needed leniency. */
export function boundaryOf(
  contentType: string,
): { readonly boundary: string; readonly unquoted: boolean } | undefined {
  for (const part of splitOutsideQuotes(contentType, ";").slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim().toLowerCase() !== "boundary") continue;
    const raw = part.slice(eq + 1).trim();
    if (raw.startsWith('"')) {
      if (raw.length < 2 || !raw.endsWith('"')) return undefined;
      const boundary = raw.slice(1, -1).replace(/\\(.)/g, "$1");
      return boundary === "" ? undefined : { boundary, unquoted: false };
    }
    return raw === "" ? undefined : { boundary: raw, unquoted: !TOKEN.test(raw) };
  }
  return undefined;
}

/**
 * The media types a Content-Type names: one, unless the response carried the
 * header more than once and `fetch` joined them with `, ` (Weaver). A comma
 * inside a quoted parameter value is not a separator.
 */
export function mediaTypesNamed(contentType: string): readonly string[] {
  return splitOutsideQuotes(contentType, ",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function readMultipart(contentType: string, bytes: Uint8Array): MultipartRead {
  const found = boundaryOf(contentType);
  if (found === undefined) return { ok: false, reason: "no-boundary" };
  const text = binaryString(bytes);
  const lenient: MultipartLeniency[] = found.unquoted ? ["unquoted-boundary"] : [];
  const strict = split(text, found.boundary, "\r\n");
  if (strict !== undefined) return { ok: true, parts: strict.map(partOf(bytes, "\r\n")), lenient };
  const loose = split(text, found.boundary, "\n");
  if (loose === undefined) return { ok: false, reason: "framing" };
  return {
    ok: true,
    parts: loose.map(partOf(bytes, "\n")),
    lenient: ["lf-line-endings", ...lenient],
  };
}

/** Each part's [start, end) in the body, or undefined when the framing does not hold. */
function split(
  text: string,
  boundary: string,
  eol: string,
): readonly (readonly [number, number])[] | undefined {
  const dash = `--${boundary}`;
  // The first delimiter opens the body, or follows a preamble on a line of its own.
  let at = text.startsWith(dash) ? 0 : text.indexOf(`${eol}${dash}`);
  if (at === -1) return undefined;
  if (at > 0) at += eol.length;
  const ranges: (readonly [number, number])[] = [];
  for (;;) {
    let cursor = at + dash.length;
    if (text.startsWith("--", cursor)) return ranges.length === 0 ? undefined : ranges;
    // Transport padding, then the end of the delimiter line.
    while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
    if (!text.startsWith(eol, cursor)) return undefined;
    const start = cursor + eol.length;
    const next = text.indexOf(`${eol}${dash}`, start);
    // No further delimiter, so no close delimiter: not a multipart we can read.
    if (next === -1) return undefined;
    ranges.push([start, next]);
    at = next + eol.length;
  }
}

/** One part: its headers up to the first empty line, its body after it. */
function partOf(bytes: Uint8Array, eol: string) {
  return ([start, end]: readonly [number, number]): MultipartPart => {
    const text = binaryString(bytes.subarray(start, end));
    // A part may have no headers at all: then it opens with the empty line.
    const blank = text.startsWith(eol) ? 0 : text.indexOf(`${eol}${eol}`);
    const headerEnd = blank === -1 ? text.length : blank;
    const bodyStart =
      blank === -1 ? text.length : blank === 0 ? eol.length : blank + 2 * eol.length;
    const headers: Record<string, string> = {};
    let last: string | undefined;
    for (const line of text.slice(0, headerEnd).split(eol)) {
      if (line === "") continue;
      if ((line.startsWith(" ") || line.startsWith("\t")) && last !== undefined) {
        headers[last] = `${headers[last] ?? ""} ${line.trim()}`;
        continue;
      }
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      last = line.slice(0, colon).trim().toLowerCase();
      headers[last] = line.slice(colon + 1).trim();
    }
    return { headers, body: bytes.slice(start + bodyStart, end) };
  };
}

/** Bytes as a string of the same length, one character per byte, for finding delimiters. */
function binaryString(bytes: Uint8Array): string {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return out;
}

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) escaped = false;
    else if (ch === "\\" && quoted) escaped = true;
    else if (ch === '"') quoted = !quoted;
    else if (ch === separator && !quoted) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}
