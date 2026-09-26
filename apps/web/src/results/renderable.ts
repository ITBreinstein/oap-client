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

import { isJsonMediaType, resolveHref, type ResponseEnvelope } from "@breinstein/oap-client";
import type { LoadedReference } from "./reference.js";

export type RenderableResult =
  | { readonly kind: "json"; readonly outputId: string; readonly value: unknown }
  | {
      readonly kind: "text";
      readonly outputId: string;
      readonly value: string;
      readonly mediaType: string;
    }
  | {
      readonly kind: "download";
      readonly outputId: string;
      readonly blob: Blob;
      readonly mediaType?: string | undefined;
      readonly filename?: string | undefined;
      /** Why this was not shown: not text, or too large to show. */
      readonly reason: "not-text" | "too-large";
      /**
       * The parsed value, when this is JSON too large to show: not shown, but
       * still read, so GeoJSON can go on the map (`plottable.ts`).
       */
      readonly json?: unknown;
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
    };

/**
 * Above this, JSON and text are offered as a download instead of shown. It
 * applies to what would be shown: each output of a results document on its
 * own, so an image carried in it as base64 — shown as a picture, never as
 * text — does not push the JSON beside it out of view.
 */
export const DEFAULT_DISPLAY_LIMIT_BYTES = 512 * 1024;

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

/** Text a person can read: `text/*` and XML. HTML counts, and is shown as source. */
export function isTextual(mediaType: string | undefined): boolean {
  if (mediaType === undefined) return false;
  return (
    mediaType.startsWith("text/") || mediaType === "application/xml" || mediaType.endsWith("+xml")
  );
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
  };
}

export async function toRenderable(
  envelope: ResponseEnvelope,
  options: RenderOptions,
): Promise<RenderableResult[]> {
  const limit = options.displayLimitBytes ?? DEFAULT_DISPLAY_LIMIT_BYTES;
  const single = options.outputIds.length === 1 ? (options.outputIds[0] ?? "result") : "result";
  const { mediaType } = envelope;
  const download = async (
    reason: "not-text" | "too-large",
    json?: unknown,
  ): Promise<RenderableResult[]> => [
    {
      kind: "download",
      outputId: single,
      blob: await envelope.blob(),
      mediaType,
      filename: envelope.filename ?? defaultFilename(options.processId, single, mediaType),
      reason,
      ...(json === undefined ? {} : { json }),
    },
  ];

  if (envelope.bodyTooLarge) return download("too-large");
  if (!envelope.isJson && !isTextual(mediaType)) return download("not-text");

  const text = await envelope.text();
  const tooLarge = byteLength(text) > limit;

  if (envelope.isJson) {
    let value: unknown;
    try {
      value = await envelope.json();
    } catch {
      // Labelled JSON and is not (ZOO does this, finding 0026): show the text.
      if (tooLarge) return download("too-large");
      return [
        { kind: "text", outputId: single, value: text, mediaType: mediaType ?? "text/plain" },
      ];
    }
    const entries = splitResults(value, options.outputIds);
    if (entries !== undefined) {
      return entries.map(([id, entry]) =>
        withinLimit(fromEntry(id, entry, options, envelope.url), limit, options.processId),
      );
    }
    if (tooLarge) return download("too-large", value);
    return [{ kind: "json", outputId: single, value }];
  }

  if (tooLarge) return download("too-large");

  return [{ kind: "text", outputId: single, value: text, mediaType: mediaType ?? "text/plain" }];
}
