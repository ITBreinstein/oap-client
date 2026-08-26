/**
 * {@link ResponseEnvelope} — everything the core knows about one HTTP response,
 * captured at the moment it arrived.
 *
 * Two things it deliberately does *not* have:
 *
 * - No `ok`, no `success`. Whether a response is usable is a judgement, and it
 *   belongs to the classifier, which has to read the body to make it. A 200
 *   carrying a problem document is not ok; a 404 from a capability probe is.
 *   An `ok` field here would invite every call site to make that call wrong.
 * - No retry, no polling, no interpretation. The envelope is evidence.
 */

import { BodyTooLargeError } from "./errors.js";
import { isJsonMediaType, parseContentDisposition, parseMediaType } from "./media-type.js";
import { parseLinkHeader, resolve, type WebLink } from "./link-header.js";

/**
 * Bodies above this are not buffered, so `json()`, `text()` and `arrayBuffer()`
 * refuse and only `blob()` is available. Process results are routinely large;
 * the point is that nothing decodes 400 MB of GeoTIFF into a string by accident.
 * Override per request with `maxBufferBytes`.
 */
export const DEFAULT_MAX_BUFFER_BYTES: number = 8 * 1024 * 1024;

export interface ResponseEnvelope {
  /** The URL we asked for. */
  readonly requestedUrl: string;
  /** The URL we ended at, after redirects. Everything relative resolves against this. */
  readonly url: string;
  readonly status: number;
  /** Retained whole: a header we do not model today is still evidence tomorrow. */
  readonly headers: Headers;

  /** Lowercased `type/subtype`, or undefined if Content-Type was absent or malformed. */
  readonly mediaType: string | undefined;
  /** Content-Type parameters, e.g. `charset`, `profile`. */
  readonly mediaTypeParams: Readonly<Record<string, string>>;
  /** True for `application/json` and any `+json` structured suffix. */
  readonly isJson: boolean;

  /** OGC `Content-Crs`, e.g. `<http://www.opengis.net/def/crs/OGC/1.3/CRS84>`. */
  readonly contentCrs: string | undefined;
  /** From Content-Disposition; path separators stripped. */
  readonly filename: string | undefined;
  /** Retry-After as milliseconds, from either delta-seconds or an HTTP-date. */
  readonly retryAfterMs: number | undefined;

  /** Location resolved against {@link url} — the *final* URL, not the requested one. */
  readonly location: string | undefined;
  /** Location exactly as received. */
  readonly locationRaw: string | undefined;

  /** From the `Link` header only. Body links are a later concern. */
  readonly links: readonly WebLink[];

  /** True when Content-Length exceeded the buffer limit; only `blob()` will work. */
  readonly bodyTooLarge: boolean;

  /**
   * Readers. The underlying body streams exactly once, so the first reader
   * buffers it and the rest derive from that buffer: `json()` then `text()`
   * both work, in either order, any number of times.
   */
  json(): Promise<unknown>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface EnvelopeOptions {
  /** What the caller asked for; defaults to the response's own URL. */
  readonly requestedUrl?: string | undefined;
  readonly maxBufferBytes?: number | undefined;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (value === "") return undefined;

  // delta-seconds: a non-negative integer.
  if (/^\d+$/.test(value)) return Number(value) * 1000;

  // HTTP-date. Already-elapsed dates clamp to 0 rather than going negative.
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}

function declaredLength(headers: Headers): number | undefined {
  const raw = headers.get("content-length");
  if (raw === null) return undefined;
  const length = Number(raw);
  return Number.isInteger(length) && length >= 0 ? length : undefined;
}

/**
 * Wraps a `Response`. Header parsing happens eagerly — it is cheap, and it means
 * a caller that never reads the body still gets the full set of observations.
 * The body itself stays untouched until a reader is called.
 */
export function createEnvelope(
  response: Response,
  options: EnvelopeOptions = {},
): ResponseEnvelope {
  // A hand-built or service-worker-synthesised Response has an empty `url`;
  // fall back to what was asked for, so relative resolution still has a base.
  const url = response.url === "" ? (options.requestedUrl ?? "") : response.url;
  const headers = response.headers;
  const limit = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  const { mediaType, params } = parseMediaType(headers.get("content-type"));
  const locationRaw = headers.get("location") ?? undefined;
  const length = declaredLength(headers);
  // Only a *declared* length can be guarded. A chunked response has none, so it
  // buffers; that is a known gap, not an oversight.
  const bodyTooLarge = length !== undefined && length > limit;

  let buffered: Promise<ArrayBuffer> | undefined;
  let blobbed: Promise<Blob> | undefined;

  function buffer(): Promise<ArrayBuffer> {
    if (bodyTooLarge) {
      return Promise.reject(new BodyTooLargeError(url, length, limit));
    }
    buffered ??= response.arrayBuffer();
    return buffered;
  }

  // The charset the server declared, falling back to UTF-8 as HTTP requires.
  // An unknown label makes the TextDecoder constructor throw, and a body we
  // cannot name is still a body we must hand over — so that falls back too.
  // Decoding itself is non-fatal by default: mojibake is recoverable evidence,
  // a thrown decode is not.
  function decoder(): TextDecoder {
    const charset = params["charset"];
    if (charset === undefined) return new TextDecoder();
    try {
      return new TextDecoder(charset);
    } catch {
      return new TextDecoder();
    }
  }

  async function text(): Promise<string> {
    return decoder().decode(await buffer());
  }

  return {
    requestedUrl: options.requestedUrl ?? url,
    url,
    status: response.status,
    headers,

    mediaType,
    mediaTypeParams: params,
    isJson: isJsonMediaType(mediaType),

    contentCrs: headers.get("content-crs") ?? undefined,
    filename: parseContentDisposition(headers.get("content-disposition")),
    retryAfterMs: parseRetryAfter(headers.get("retry-after")),

    location: locationRaw === undefined ? undefined : resolve(locationRaw, url),
    locationRaw,

    links: parseLinkHeader(headers.get("link"), url),

    bodyTooLarge,

    async json(): Promise<unknown> {
      return JSON.parse(await text()) as unknown;
    },
    text,
    async blob(): Promise<Blob> {
      // Over the limit nothing is buffered, so the body is streamed straight
      // into a Blob — the one reader that never has to hold a decoded copy.
      if (bodyTooLarge) {
        blobbed ??= response.blob();
        return blobbed;
      }
      return new Blob([await buffer()], mediaType === undefined ? {} : { type: mediaType });
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      // A copy per call: readers must be independent, and handing every caller
      // the same buffer means one of them mutating it corrupts the others.
      return (await buffer()).slice(0);
    },
  };
}
