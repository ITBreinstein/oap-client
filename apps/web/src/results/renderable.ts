/**
 * From a response envelope to what the result screen shows (T10).
 *
 * JSON is shown pretty-printed, text is shown as text and never rendered as
 * HTML, and everything else is offered as a download with its media type,
 * file name and size. GeoJSON is also put on the map, from the JSON it is
 * shown as, and an image a browser shows is shown and sometimes placed
 * (`plottable.ts`). An output given by reference is its own arm (Task 8, T1):
 * a link, followed only when the user asks (`reference.ts`).
 *
 * Built on the core's envelope and its readers: nothing here reads a stream
 * or a header by hand. What *is* here is the one interpretation the core
 * leaves to the web app on purpose (its §7.3): which media type means what,
 * and how a results document splits into outputs.
 */

import {
  createEnvelope,
  DEFAULT_MAX_BUFFER_BYTES,
  isJsonMediaType,
  resolveHref,
  type ResponseEnvelope,
} from "@breinstein/oap-client";
import { placeGeoJson, readContentCrs, type Placement } from "./crs.js";
import {
  mediaTypesNamed,
  readMultipart,
  type MultipartLeniency,
  type MultipartPart,
} from "./multipart.js";
import type { LoadedReference } from "./reference.js";
import {
  base64Bytes,
  magicOf,
  readLabelledXml,
  sniffXml,
  SNIFFED_MEDIA_TYPES,
  type GeoRead,
  type Sniffed,
} from "./sniff.js";

/**
 * What was asked for and what arrived, for an output the run asked a format
 * for (#F3). `received` is the media type the output came with: the
 * response's own for a raw answer, the entry's for one inside a results
 * document, and absent when nothing said.
 */
export interface FormatFacts {
  readonly asked?: string | undefined;
  readonly received?: string | undefined;
}

/**
 * How the answer was read, where it took more than the standard's own shape.
 * Each is a tolerance the result observation records, so it stays visible in
 * the matrix rather than being smoothed over.
 */
export interface ReadFacts {
  /**
   * The results document came inside a one-element `outputs` array:
   * pygeoapi's answer to `response: "document"` (finding 0027).
   */
  readonly documentWrapper?: "outputs-array" | undefined;
  /**
   * The output was one part of a `multipart/related` answer (`multipart.ts`):
   * the tolerances its framing needed, empty when it needed none.
   */
  readonly multipartLenient?: readonly MultipartLeniency[] | undefined;
}

/**
 * Why a download was not shown. `multipart-unreadable`: a `multipart/related`
 * answer whose parts cannot be told apart by RFC 2046, even with the two
 * tolerances `multipart.ts` allows (ZOO, finding 0073).
 * `two-media-types`: a Content-Type naming more than one media type, the
 * header sent twice (Weaver), so nothing says what the body is.
 */
export type DownloadReason = "not-text" | "too-large" | "multipart-unreadable" | "two-media-types";

export type RenderableResult = (
  | {
      readonly kind: "json";
      readonly outputId: string;
      readonly value: unknown;
      /** Where its GeoJSON goes on the map, from the response's `Content-Crs` (#F1). */
      readonly placement?: Placement | undefined;
    }
  | {
      readonly kind: "text";
      readonly outputId: string;
      readonly value: string;
      readonly mediaType: string;
      /**
       * The bytes the server sent, which Download saves. Absent for a text
       * taken from inside a results document, which has no bytes of its own.
       */
      readonly blob?: Blob | undefined;
      /** GML or KML, read for the map (#F4, #F5), or refused with a reason. */
      readonly geo?: GeoRead | undefined;
      /** What the bytes turned out to be, when the label said otherwise. */
      readonly sniffed?: Sniffed | undefined;
    }
  | {
      readonly kind: "download";
      readonly outputId: string;
      readonly blob: Blob;
      readonly mediaType?: string | undefined;
      readonly filename?: string | undefined;
      /** Why this was not shown. */
      readonly reason: DownloadReason;
      /**
       * The parsed value, when this is JSON too large to show: not shown, but
       * still read, so GeoJSON can go on the map (`plottable.ts`).
       */
      readonly json?: unknown;
      /** As for `json`: where `json`'s GeoJSON goes on the map (#F1). */
      readonly placement?: Placement | undefined;
      /** GML or KML too large to show, still read for the map (#F4, #F5). */
      readonly geo?: GeoRead | undefined;
      /** What the bytes turned out to be, when the label said otherwise. */
      readonly sniffed?: Sniffed | undefined;
    }
  | {
      /**
       * An output given by reference: a `link.yaml` object in the results
       * document (Task 8, T1). Nothing has been fetched; `loaded` is what the
       * user's "Load" found.
       */
      readonly kind: "reference";
      readonly outputId: string;
      /** Resolved against the URL the results document was served from. */
      readonly href: string;
      /** The link's `type`, or ZOO's `format.mediaType`: what the server says it is. */
      readonly mediaType?: string | undefined;
      readonly rel?: string | undefined;
      readonly title?: string | undefined;
      readonly loaded?: LoadedReference | undefined;
    }
) &
  FormatFacts &
  ReadFacts;

/**
 * Above this, JSON and text are offered as a download instead of shown. It
 * applies to what would be shown: each output of a results document on its
 * own, so an image carried in it as base64 — shown as a picture, never as
 * text — does not push the JSON beside it out of view.
 */
export const DEFAULT_DISPLAY_LIMIT_BYTES = 512 * 1024;

/**
 * How much of a run's result this page reads: enough to offer any realistic
 * output as a download. At the core's 8 MB, a result that declared no length
 * was cut off as it arrived and the user got an error, the result itself lost
 * (review W7). The session's clients read with it (`relay/job-session.ts`). An
 * output given by reference keeps the core's limit: its URL is the server's
 * choice.
 */
export const RESULT_READ_LIMIT_BYTES = 256 * 1024 * 1024;

/**
 * Above this a result is only offered as a download: not decoded, not parsed,
 * not put on the map. The core's own read limit, where a result used to stop
 * being readable at all, so everything below it behaves as it always did.
 */
export const DEFAULT_PARSE_LIMIT_BYTES = DEFAULT_MAX_BUFFER_BYTES;

export interface RenderOptions {
  /** The process's declared output ids, in order. */
  readonly outputIds: readonly string[];
  /** Used to name a download when the server sent no Content-Disposition. */
  readonly processId: string;
  /**
   * Each output's declared `contentMediaType`, where it has one. Tells a bare
   * string in a results document apart: pygeoapi sends a `text/plain` output
   * as a plain JSON string, with nothing but the description to say it is text.
   */
  readonly declaredMediaTypes?: Readonly<Record<string, string | undefined>> | undefined;
  readonly displayLimitBytes?: number | undefined;
  readonly parseLimitBytes?: number | undefined;
  /**
   * The media type the run asked for each output (#F3), so the result can
   * say when the service sent something else.
   */
  readonly askedFormats?: Readonly<Record<string, string>> | undefined;
  /**
   * Outputs whose description declares base64 for what was asked
   * (`format-choice.ts`): a body that is neither JSON nor anything sniffing
   * knows is tried as base64 once (§11 of the brief).
   */
  readonly base64Outputs?: readonly string[] | undefined;
  /**
   * The `response` the run sent, when it sent one. A body answering
   * `"document"` is read as a results document, pygeoapi's wrapped one
   * included (finding 0027).
   */
  readonly requestedResponse?: "document" | undefined;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "application/json": "json",
  "application/geo+json": "geojson",
  "application/xml": "xml",
  "text/xml": "xml",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/html": "html",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/tiff": "tif",
  "application/gml+xml": "gml",
  "application/vnd.google-earth.kml+xml": "kml",
  "application/zip": "zip",
  "application/pdf": "pdf",
};

export function defaultFilename(
  processId: string,
  outputId: string,
  mediaType: string | undefined,
): string {
  const extension = (mediaType === undefined ? undefined : EXTENSIONS[mediaType]) ?? "bin";
  return `${processId}-${outputId}.${extension}`;
}

/** A media type without its parameters, in lower case: `text/csv; charset=utf-8` is `text/csv`. */
function essence(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * The file name a text result downloads as (#26): its media type's extension
 * when the map above knows it, `.txt` otherwise. A CSV is `.csv`.
 */
export function textFilename(processId: string, outputId: string, mediaType: string): string {
  const extension = EXTENSIONS[essence(mediaType)] ?? "txt";
  return `${processId}-${outputId}.${extension}`;
}

/** Whether a media type is CSV, parameters or not. */
export function isCsv(mediaType: string | undefined): boolean {
  return mediaType !== undefined && essence(mediaType) === "text/csv";
}

/**
 * Text a person can read: `text/*` and XML, parameters or not. HTML counts,
 * and is shown as source.
 */
export function isTextual(mediaType: string | undefined): boolean {
  if (mediaType === undefined) return false;
  const type = essence(mediaType);
  return type.startsWith("text/") || type === "application/xml" || type.endsWith("+xml");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `mediaType` on a qualified value, flat (1.0) or under `format` (ZOO). */
function qualifiedMediaType(entry: Record<string, unknown>): string | undefined {
  if (typeof entry["mediaType"] === "string") return entry["mediaType"];
  const format = entry["format"];
  return isRecord(format) && typeof format["mediaType"] === "string"
    ? format["mediaType"]
    : undefined;
}

function qualifiedEncoding(entry: Record<string, unknown>): string | undefined {
  if (typeof entry["encoding"] === "string") return entry["encoding"];
  const format = entry["format"];
  return isRecord(format) && typeof format["encoding"] === "string"
    ? format["encoding"]
    : undefined;
}

function base64Blob(text: string, mediaType: string | undefined): Blob {
  const binary = atob(text.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], mediaType === undefined ? {} : { type: mediaType });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * An entry with a string `href` and no `value`: `link.yaml`, whose only
 * required member is `href`. pygeoapi's carries `type`, `rel` and `title`;
 * ZOO's carries nothing, or `format.mediaType`, or both `type` and `format`.
 */
function fromLink(
  outputId: string,
  entry: Record<string, unknown>,
  href: string,
  base: string,
): RenderableResult {
  const mediaType = optionalString(entry["type"]) ?? qualifiedMediaType(entry);
  const rel = optionalString(entry["rel"]);
  const title = optionalString(entry["title"]);
  return {
    kind: "reference",
    outputId,
    // Unresolvable stays as sent: it is then refused before any fetch (T7).
    href: resolveHref(href, base) ?? href,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(rel === undefined ? {} : { rel }),
    ...(title === undefined ? {} : { title }),
  };
}

/** One output's entry in a results document: a bare value, a qualified value or a link. */
function fromEntry(
  outputId: string,
  entry: unknown,
  options: RenderOptions,
  base: string,
): RenderableResult {
  if (isRecord(entry) && typeof entry["href"] === "string" && !("value" in entry)) {
    return fromLink(outputId, entry, entry["href"], base);
  }
  if (typeof entry === "string") {
    const declared = options.declaredMediaTypes?.[outputId];
    if (declared === undefined || isTextual(declared)) {
      return { kind: "text", outputId, value: entry, mediaType: declared ?? "text/plain" };
    }
  }
  if (!isRecord(entry) || !("value" in entry)) return { kind: "json", outputId, value: entry };

  const mediaType = qualifiedMediaType(entry);
  const value = entry["value"];
  if (typeof value !== "string" || mediaType === undefined || isJsonMediaType(mediaType)) {
    return { kind: "json", outputId, value };
  }
  if (qualifiedEncoding(entry)?.toLowerCase() === "base64") {
    try {
      return {
        kind: "download",
        outputId,
        blob: base64Blob(value, mediaType),
        mediaType,
        filename: defaultFilename(options.processId, outputId, mediaType),
        reason: "not-text",
      };
    } catch {
      // Labelled base64 and is not: show what arrived rather than nothing.
    }
  }
  if (isTextual(mediaType)) return { kind: "text", outputId, value, mediaType };
  return {
    kind: "download",
    outputId,
    blob: new Blob([value], { type: mediaType }),
    mediaType,
    filename: defaultFilename(options.processId, outputId, mediaType),
    reason: "not-text",
  };
}

/** The media type a results-document entry says it is: a link's, or a qualified value's. */
function entryMediaType(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  if (typeof entry["href"] === "string" && !("value" in entry)) {
    return optionalString(entry["type"]) ?? qualifiedMediaType(entry);
  }
  return "value" in entry ? qualifiedMediaType(entry) : undefined;
}

/** Each result with what was asked for it and what arrived, where it was asked a format (#F3). */
function withFormats(
  results: RenderableResult[],
  asked: Readonly<Record<string, string>> | undefined,
  received: (outputId: string) => string | undefined,
): RenderableResult[] {
  if (asked === undefined) return results;
  return results.map((result) => {
    const mediaType = asked[result.outputId];
    if (mediaType === undefined) return result;
    const arrived = received(result.outputId);
    return { ...result, asked: mediaType, ...(arrived === undefined ? {} : { received: arrived }) };
  });
}

/**
 * A raw JSON body is either one output's value or a results document keyed
 * by output id. It is split only when every key is a declared output and
 * either there is more than one, or the one entry is itself a value wrapper —
 * so a single output that happens to be an object is shown whole.
 */
function splitResults(
  value: unknown,
  outputIds: readonly string[],
): [string, unknown][] | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((key) => outputIds.includes(key))) return undefined;
  const wrapped = (entry: unknown) => isRecord(entry) && ("value" in entry || "href" in entry);
  if (keys.length === 1 && !wrapped(value[keys[0] ?? ""])) return undefined;
  return keys.map((key) => [key, value[key]]);
}

/**
 * pygeoapi's answer to `response: "document"`: `{"outputs": [map]}`, the map
 * keyed by output id (finding 0027). Only when a document was asked for, only
 * when `outputs` is not itself an output, and only when the one element's keys
 * are all declared outputs. Anything else is not this shape and is read as it
 * came.
 */
function outputsArrayDocument(
  value: unknown,
  outputIds: readonly string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value) || outputIds.includes("outputs")) return undefined;
  const keys = Object.keys(value);
  const list = value["outputs"];
  if (keys.length !== 1 || !Array.isArray(list) || list.length !== 1) return undefined;
  const [map] = list as unknown[];
  if (!isRecord(map)) return undefined;
  const ids = Object.keys(map);
  return ids.length > 0 && ids.every((id) => outputIds.includes(id)) ? map : undefined;
}

/**
 * The body as text, only if its bytes decode cleanly in the charset it
 * declares (UTF-8 when it declares none, or one this browser does not know).
 * Bytes that do not are not text, whatever the label says: ZOO labels every raw
 * result `application/json` (finding 0026), and decoding a PNG anyway showed
 * replacement characters and saved them as its Download (review W6).
 */
function strictText(bytes: ArrayBuffer, charset: string | undefined): string | undefined {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8", { fatal: true });
  } catch {
    decoder = new TextDecoder("utf-8", { fatal: true });
  }
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** One output of a results document, made a download when it is too large to show. */
function withinLimit(result: RenderableResult, limit: number, processId: string): RenderableResult {
  if (result.kind === "download" || result.kind === "reference") return result;
  const text = result.kind === "json" ? JSON.stringify(result.value, null, 2) : result.value;
  if (byteLength(text) <= limit) return result;
  const mediaType = result.kind === "json" ? "application/json" : result.mediaType;
  return {
    kind: "download",
    outputId: result.outputId,
    blob: new Blob([text], { type: mediaType }),
    mediaType,
    filename: defaultFilename(processId, result.outputId, mediaType),
    reason: "too-large",
    ...(result.kind === "json" ? { json: result.value } : {}),
    ...(result.kind === "text" && result.geo !== undefined ? { geo: result.geo } : {}),
  };
}

/** A text output read for the map when it is labelled as XML, GML or KML (#F4, #F5). */
async function withGeo(result: RenderableResult): Promise<RenderableResult> {
  if (result.kind !== "text") return result;
  const geo = await readLabelledXml(result.value, result.mediaType);
  return geo === undefined ? result : { ...result, geo };
}

export async function toRenderable(
  envelope: ResponseEnvelope,
  options: RenderOptions,
): Promise<RenderableResult[]> {
  const { results, entries, parts } = await render(envelope, options);
  return withFormats(results, options.askedFormats, (outputId) =>
    parts !== undefined
      ? parts.get(outputId)
      : entries === undefined
        ? envelope.mediaType
        : entryMediaType(entries.get(outputId)),
  );
}

interface Rendered {
  readonly results: RenderableResult[];
  /** A results document's entries, by output id, when the body was one. */
  readonly entries?: ReadonlyMap<string, unknown>;
  /** A multipart answer's parts' media types, by output id, when the body was one. */
  readonly parts?: ReadonlyMap<string, string | undefined>;
}

/** A part's `Content-ID`, without the angle brackets RFC 2392 puts round it. */
function contentIdOf(part: MultipartPart): string | undefined {
  const id = part.headers["content-id"]?.trim();
  if (id === undefined || id === "") return undefined;
  return id.startsWith("<") && id.endsWith(">") ? id.slice(1, -1) : id;
}

/**
 * Each part of a `multipart/related` answer, read as the one output its
 * `Content-ID` names (Requirement 29 E), through the same path a raw answer
 * with one output takes. A part with an empty body and a `Content-Location`
 * is that output by reference (Requirement 31 F).
 */
async function fromParts(
  envelope: ResponseEnvelope,
  parts: readonly MultipartPart[],
  lenient: readonly MultipartLeniency[],
  options: RenderOptions,
): Promise<Rendered> {
  const types = new Map<string, string | undefined>();
  const read = await Promise.all(
    parts.map(async (part, index): Promise<RenderableResult[]> => {
      const outputId = contentIdOf(part) ?? `part ${String(index + 1)}`;
      const mediaType = part.headers["content-type"];
      types.set(outputId, mediaType);
      const location = part.headers["content-location"];
      if (location !== undefined && part.body.byteLength === 0) {
        return [
          {
            kind: "reference",
            outputId,
            href: resolveHref(location, envelope.url) ?? location,
            ...(mediaType === undefined ? {} : { mediaType }),
          },
        ];
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(part.headers)) {
        try {
          headers.set(name, value);
        } catch {
          // A header Fetch will not carry is left behind; the bytes are what count.
        }
      }
      const one = createEnvelope(new Response(part.body.slice(), { headers }), {
        requestedUrl: envelope.url,
      });
      return (await render(one, { ...options, outputIds: [outputId] })).results;
    }),
  );
  return {
    results: read.flat().map((result) => ({ ...result, multipartLenient: lenient })),
    parts: types,
  };
}

/** The results, and the results document's entries when the body was one. */
async function render(envelope: ResponseEnvelope, options: RenderOptions): Promise<Rendered> {
  const results = (list: RenderableResult[]) => ({ results: list });
  const limit = options.displayLimitBytes ?? DEFAULT_DISPLAY_LIMIT_BYTES;
  const single = options.outputIds.length === 1 ? (options.outputIds[0] ?? "result") : "result";
  const { mediaType } = envelope;
  // The response's Content-Crs names the system of its body (#F1), and so of
  // a body that is one output's value. Not of the outputs inside a results
  // document: one header cannot say which of them it is about.
  const contentCrs = readContentCrs(envelope.contentCrs);
  const placed = async (value: unknown): Promise<{ placement?: Placement }> =>
    contentCrs === undefined
      ? {}
      : { placement: await placeGeoJson(value, contentCrs, "content-crs") };
  const download = async (
    reason: DownloadReason,
    json?: unknown,
    geo?: GeoRead,
  ): Promise<RenderableResult[]> => [
    {
      kind: "download",
      outputId: single,
      blob: await envelope.blob(),
      mediaType,
      filename: envelope.filename ?? defaultFilename(options.processId, single, mediaType),
      reason,
      ...(json === undefined ? {} : { json, ...(await placed(json)) }),
      ...(geo === undefined ? {} : { geo }),
    },
  ];

  if (envelope.bodyTooLarge) return results(await download("too-large"));

  // A Content-Type sent twice names two media types (Weaver's raw answer):
  // nothing says which the body is, so it is offered as it came, labelled as
  // it came, and not read as either.
  const contentType = envelope.headers.get("content-type") ?? "";
  if (mediaTypesNamed(contentType).length > 1) {
    return results([
      {
        kind: "download",
        outputId: single,
        blob: await envelope.blob(),
        mediaType: contentType,
        filename: envelope.filename ?? defaultFilename(options.processId, single, undefined),
        reason: "two-media-types",
      },
    ]);
  }

  // 1.0's raw answer for several outputs (Requirement 29): read by RFC 2046,
  // with the two tolerances `multipart.ts` records, or not read at all.
  if (mediaType === "multipart/related") {
    const body = await envelope.arrayBuffer();
    if (body.byteLength > (options.parseLimitBytes ?? DEFAULT_PARSE_LIMIT_BYTES)) {
      return results(await download("too-large"));
    }
    const read = readMultipart(contentType, new Uint8Array(body));
    if (!read.ok) return results(await download("multipart-unreadable"));
    return fromParts(envelope, read.parts, read.lenient, options);
  }

  if (!envelope.isJson && !isTextual(mediaType)) return results(await download("not-text"));

  // The bytes first: they are what a Download saves, and text is only what
  // they decode to cleanly. Bytes that do not decode are not text.
  const bytes = await envelope.arrayBuffer();
  if (bytes.byteLength > (options.parseLimitBytes ?? DEFAULT_PARSE_LIMIT_BYTES)) {
    return results(await download("too-large"));
  }
  const text = strictText(bytes, envelope.mediaTypeParams["charset"]);
  const tooLarge = bytes.byteLength > limit;

  // Labelled JSON and not JSON (finding 0026): what the bytes are, from the
  // closed list in `sniff.ts`, after the limits above. The label is kept.
  const sniffed = (kind: Sniffed["kind"], base64: boolean): Sniffed => ({
    kind,
    declaredMediaType: envelope.headers.get("content-type") ?? mediaType ?? "",
    ...(base64 ? { base64: true } : {}),
  });
  const sniffedResult = (
    found: Uint8Array,
    as: Sniffed,
    read?: { text: string; geo: GeoRead },
  ): RenderableResult[] => {
    const type = SNIFFED_MEDIA_TYPES[as.kind];
    const blob = new Blob([found.slice()], { type });
    const filename = envelope.filename ?? defaultFilename(options.processId, single, type);
    if (read === undefined || found.byteLength > limit) {
      return [
        {
          kind: "download",
          outputId: single,
          blob,
          mediaType: type,
          filename,
          reason: read === undefined ? "not-text" : "too-large",
          ...(read === undefined ? {} : { geo: read.geo }),
          sniffed: as,
        },
      ];
    }
    return [
      {
        kind: "text",
        outputId: single,
        value: read.text,
        mediaType: type,
        blob,
        geo: read.geo,
        sniffed: as,
      },
    ];
  };
  const sniff = async (): Promise<RenderableResult[] | undefined> => {
    const raw = new Uint8Array(bytes);
    const magic = magicOf(raw);
    if (magic !== undefined) return sniffedResult(raw, sniffed(magic, false));
    if (text !== undefined) {
      const geo = await sniffXml(text);
      if (geo !== undefined) return sniffedResult(raw, sniffed(geo.parsedAs, false), { text, geo });
    }
    // Declared base64 and sent as it is (ZOO's KML and TIFF): the bytes were
    // looked at first, above; only now is base64 tried.
    if (text === undefined || options.base64Outputs?.includes(single) !== true) return undefined;
    const decoded = base64Bytes(text);
    if (decoded === undefined) return undefined;
    const inner = magicOf(decoded);
    if (inner !== undefined) return sniffedResult(decoded, sniffed(inner, true));
    const decodedText = strictText(decoded.slice().buffer, undefined);
    const geo = decodedText === undefined ? undefined : await sniffXml(decodedText);
    return geo === undefined || decodedText === undefined
      ? undefined
      : sniffedResult(decoded, sniffed(geo.parsedAs, true), { text: decodedText, geo });
  };

  if (text === undefined) {
    const found = envelope.isJson ? await sniff() : undefined;
    return results(found ?? (await download("not-text")));
  }
  const shownAsText = async (geo?: GeoRead): Promise<RenderableResult[]> => [
    {
      kind: "text",
      outputId: single,
      value: text,
      mediaType: mediaType ?? "text/plain",
      blob: await envelope.blob(),
      ...(geo === undefined ? {} : { geo }),
    },
  ];

  if (envelope.isJson) {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      const found = await sniff();
      if (found !== undefined) return results(found);
      // Labelled JSON and is not, nor anything sniffing knows: show the text.
      if (tooLarge) return results(await download("too-large"));
      return results(await shownAsText());
    }
    // A document asked for and sent in pygeoapi's wrapper is a document: its
    // map is split whatever its size, and the wrapper is recorded.
    const wrapped =
      options.requestedResponse === "document"
        ? outputsArrayDocument(value, options.outputIds)
        : undefined;
    const entries =
      wrapped === undefined ? splitResults(value, options.outputIds) : Object.entries(wrapped);
    if (entries !== undefined) {
      const facts: ReadFacts = wrapped === undefined ? {} : { documentWrapper: "outputs-array" };
      return {
        results: await Promise.all(
          entries.map(async ([id, entry]) => ({
            ...withinLimit(
              await withGeo(fromEntry(id, entry, options, envelope.url)),
              limit,
              options.processId,
            ),
            ...facts,
          })),
        ),
        entries: new Map(entries),
      };
    }
    if (tooLarge) return results(await download("too-large", value));
    return results([{ kind: "json", outputId: single, value, ...(await placed(value)) }]);
  }

  // Labelled as XML, GML or KML: read for the map, whether shown or too large to show.
  const geo = await readLabelledXml(text, mediaType);
  if (tooLarge) return results(await download("too-large", undefined, geo));

  return results(await shownAsText(geo));
}
