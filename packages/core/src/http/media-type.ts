/**
 * Content-Type parsing. Deliberately lenient: an unparseable header leaves
 * `mediaType` undefined rather than failing the response. The raw header stays
 * on the envelope's `headers`, so a finding can still record what was sent.
 */

export interface ParsedMediaType {
  /** Lowercased `type/subtype`, or undefined if the header was absent or malformed. */
  readonly mediaType: string | undefined;
  /** Lowercased parameter names, values unquoted and unescaped. */
  readonly params: Readonly<Record<string, string>>;
}

const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

// RFC 9110 token: no separators, no control characters, no whitespace.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Splits on `;` but not inside a quoted string, so
 * `text/plain; note="a;b"` yields two parts, not three.
 */
function splitParameters(header: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\" && quoted) {
      escaped = true;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ";" && !quoted) {
      parts.push(header.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(header.slice(start));
  return parts;
}

/** Strips surrounding quotes and unescapes `\x` sequences. */
export function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
}

export function parseMediaType(header: string | null | undefined): ParsedMediaType {
  if (header === null || header === undefined || header.trim() === "") {
    return { mediaType: undefined, params: EMPTY_PARAMS };
  }

  const [rawType, ...rawParams] = splitParameters(header);
  const essence = (rawType ?? "").trim().toLowerCase();
  const slash = essence.indexOf("/");

  // A media type is exactly one `/` between two tokens. Anything else — an
  // empty subtype, a stray comma, a bare word — is malformed, and we say so by
  // leaving mediaType undefined rather than inventing a value.
  const type = essence.slice(0, slash);
  const subtype = essence.slice(slash + 1);
  const valid = slash > 0 && TOKEN.test(type) && TOKEN.test(subtype);

  const params: Record<string, string> = {};
  for (const part of rawParams) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    if (name === "") continue;
    params[name] = unquote(part.slice(eq + 1));
  }

  return {
    mediaType: valid ? essence : undefined,
    params: Object.keys(params).length === 0 ? EMPTY_PARAMS : Object.freeze(params),
  };
}

/**
 * True for `application/json` and for anything carrying the RFC 6839 `+json`
 * structured suffix, so `application/geo+json` and `application/problem+json`
 * both read as JSON. This is why the classifier can find a problem document
 * that a server labelled `application/problem+json` rather than plain JSON.
 */
export function isJsonMediaType(mediaType: string | undefined): boolean {
  if (mediaType === undefined) return false;
  const subtype = mediaType.slice(mediaType.indexOf("/") + 1);
  return subtype === "json" || subtype.endsWith("+json");
}

/**
 * Filename from a Content-Disposition header. RFC 5987 `filename*` wins over
 * `filename`, per RFC 6266 §4.3. Any path separator is dropped: this value can
 * reach a save dialog, and a server does not get to choose a directory.
 */
export function parseContentDisposition(header: string | null | undefined): string | undefined {
  if (header === null || header === undefined) return undefined;

  let plain: string | undefined;
  let extended: string | undefined;

  for (const part of splitParameters(header).slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();

    if (name === "filename") {
      plain = unquote(value);
    } else if (name === "filename*") {
      // charset'language'percent-encoded-value
      const segments = value.split("'");
      const encoded = segments.length >= 3 ? segments.slice(2).join("'") : undefined;
      if (encoded !== undefined) {
        try {
          extended = decodeURIComponent(encoded);
        } catch {
          // A malformed percent-encoding is not a reason to lose `filename`.
        }
      }
    }
  }

  const chosen = extended ?? plain;
  if (chosen === undefined) return undefined;
  const base = chosen.split(/[/\\]/).pop();
  return base === undefined || base === "" ? undefined : base;
}
