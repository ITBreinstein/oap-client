/**
 * Which format to ask for, for an output whose description offers several
 * (#F3): the first this page can show, in this order —
 *
 *   1. GeoJSON (`application/geo+json`)
 *   2. GML, when the media type is `application/gml+xml`, or XML whose
 *      `contentSchema` or a media-type parameter says GML
 *   3. KML (`application/vnd.google-earth.kml+xml`)
 *   4. XML with nothing to say it is GML (`text/xml`, `application/xml`)
 *   5. GeoTIFF (`image/tiff`, with or without `application=geotiff`)
 *   6. any other image
 *   7. anything else: ask for nothing, and the service chooses.
 *
 * Read from the output's schema, verbatim as the core keeps it: its
 * `contentMediaType`, or each `oneOf`/`anyOf`/`allOf` branch's. The media
 * type asked for is written exactly as the description wrote it.
 *
 * The choice goes in the execute request as `outputs.{id}.format.mediaType`,
 * which means the same in OGC API - Processes 1.0 and in the 2.0 draft
 * (`format.yaml`, step-zero difference table row 26). Asking for a format
 * changes nothing else: every output is still listed, as before, so the
 * answer has the same shape — raw or a document, and the same outputs — as a
 * request without a format.
 */

import type { OutputDescription } from "@breinstein/oap-client";

/** What a media type is to this page, in the order above. */
export type FormatKind = "geojson" | "gml" | "kml" | "xml" | "geotiff" | "image" | "other";

export interface OfferedFormat {
  /** As the description wrote it, parameters and all: what is sent. */
  readonly mediaType: string;
  readonly kind: FormatKind;
}

const RANK: Readonly<Record<FormatKind, number>> = {
  geojson: 1,
  gml: 2,
  kml: 3,
  xml: 4,
  geotiff: 5,
  image: 6,
  other: 7,
};

/** A media type without its parameters, in lower case. */
export function essenceOf(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

/** A media type's parameters, names in lower case, values unquoted. */
function parametersOf(mediaType: string): ReadonlyMap<string, string> {
  const parameters = new Map<string, string>();
  for (const part of mediaType.split(";").slice(1)) {
    const equals = part.indexOf("=");
    if (equals === -1) continue;
    const name = part.slice(0, equals).trim().toLowerCase();
    const value = part
      .slice(equals + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    if (name !== "") parameters.set(name, value);
  }
  return parameters;
}

const XML = new Set(["text/xml", "application/xml"]);

/** What a media type is, given the hints its schema branch carries. */
export function formatKind(mediaType: string, contentSchema?: string): FormatKind {
  const essence = essenceOf(mediaType);
  const parameters = parametersOf(mediaType);
  if (essence === "application/geo+json") return "geojson";
  if (essence === "application/gml+xml") return "gml";
  if (essence === "application/vnd.google-earth.kml+xml") return "kml";
  if (XML.has(essence)) {
    const saysGml =
      /gml/i.test(parameters.get("subtype") ?? "") ||
      /gml/i.test(parameters.get("profile") ?? "") ||
      /gml/i.test(contentSchema ?? "");
    return saysGml ? "gml" : "xml";
  }
  if (essence === "image/tiff" || essence === "image/geotiff") return "geotiff";
  if (essence === "application/tiff" && /geotiff/i.test(parameters.get("application") ?? "")) {
    return "geotiff";
  }
  if (essence.startsWith("image/")) return "image";
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every `{contentMediaType, contentSchema}` in a schema and its composed branches. */
function mediaTypesIn(schema: unknown, depth = 0): { mediaType: string; contentSchema?: string }[] {
  if (!isRecord(schema) || depth > 4) return [];
  const found: { mediaType: string; contentSchema?: string }[] = [];
  const mediaType = schema["contentMediaType"];
  if (typeof mediaType === "string" && mediaType.trim() !== "") {
    const contentSchema = schema["contentSchema"];
    found.push({
      mediaType: mediaType.trim(),
      ...(typeof contentSchema === "string" ? { contentSchema } : {}),
    });
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      for (const branch of branches as unknown[]) found.push(...mediaTypesIn(branch, depth + 1));
    }
  }
  return found;
}

/**
 * The formats an output's description offers, each once, in the order this
 * page prefers them. A media type offered twice, once with a GML hint, counts
 * as GML.
 */
export function offeredFormats(output: OutputDescription): readonly OfferedFormat[] {
  const byType = new Map<string, OfferedFormat>();
  for (const { mediaType, contentSchema } of mediaTypesIn(output.schema)) {
    const kind = formatKind(mediaType, contentSchema);
    const known = byType.get(mediaType);
    if (known === undefined || RANK[kind] < RANK[known.kind])
      byType.set(mediaType, { mediaType, kind });
  }
  return [...byType.values()].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

/**
 * The format to ask for when the user has not chosen one: the first of the
 * order above, for an output that offers two or more. Undefined when it
 * offers fewer, or nothing this page can show — then nothing is asked for.
 */
export function preferredFormat(offered: readonly OfferedFormat[]): OfferedFormat | undefined {
  if (offered.length < 2) return undefined;
  const [first] = offered;
  return first === undefined || first.kind === "other" ? undefined : first;
}

/**
 * The user's choice for one output: a media type, or `null` for "let the
 * service choose". Absent: the page's own choice, `preferredFormat`.
 */
export type FormatChoices = Readonly<Record<string, string | null>>;

/** The media type to ask for, per output, after the user's choices; outputs asked for nothing are left out. */
export function formatsToAsk(
  outputs: readonly OutputDescription[],
  choices: FormatChoices = {},
): Readonly<Record<string, string>> {
  const asked: Record<string, string> = {};
  for (const output of outputs) {
    const offered = offeredFormats(output);
    const chosen = choices[output.id];
    const mediaType =
      chosen === null
        ? undefined
        : chosen !== undefined && offered.some((format) => format.mediaType === chosen)
          ? chosen
          : preferredFormat(offered)?.mediaType;
    if (mediaType !== undefined) asked[output.id] = mediaType;
  }
  return asked;
}

const WORDS: Readonly<Record<FormatKind, string | undefined>> = {
  geojson: "GeoJSON",
  gml: "GML",
  kml: "KML",
  xml: "XML",
  geotiff: "GeoTIFF",
  image: undefined,
  other: undefined,
};

const ESSENCE_WORDS: Readonly<Record<string, string>> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "application/json": "JSON",
  "text/csv": "CSV",
  "text/plain": "text",
  "text/html": "HTML",
  "application/zip": "a ZIP file",
};

/** A format in words: "GeoJSON", "GML", "PNG", or its media type when there is no word for it. */
export function formatWords(format: OfferedFormat): string {
  return WORDS[format.kind] ?? ESSENCE_WORDS[essenceOf(format.mediaType)] ?? format.mediaType;
}

/** Words for a list, each once: "GML", "GML and KML", "GML, KML and XML". */
function listed(all: readonly string[]): string {
  const words = [...new Set(all)];
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/**
 * What the form says beside an output that offers several formats:
 * "Asked for GeoJSON; the service also offers GML and KML." An output that may
 * have several values (`maxOccurs` above 1) says the format is for each of them.
 */
export function formatLine(
  output: OutputDescription,
  offered: readonly OfferedFormat[],
  asked: string | undefined,
): string {
  const askedFormat = offered.find((format) => format.mediaType === asked);
  const others = listed(
    offered.filter((format) => format.mediaType !== asked).map((format) => formatWords(format)),
  );
  if (askedFormat === undefined) {
    return `Asked for no format: the service chooses. It offers ${listed(offered.map((format) => formatWords(format)))}.`;
  }
  const each = output.multiple ? ", for each of its values" : "";
  return `Asked for ${formatWords(askedFormat)}${each}; the service also offers ${others}.`;
}

/** A media type in words, as `formatWords`, from the media type alone. */
export function mediaTypeWords(mediaType: string): string {
  return formatWords({ mediaType, kind: formatKind(mediaType) });
}

/**
 * What a result says when the service sent another format than the one asked
 * for: "Asked for GeoJSON; the service sent it as application/json." By label,
 * not by content: what the service called it is the evidence, whatever the
 * body turns out to be. Undefined when they agree, or nothing said what arrived.
 */
export function formatSentLine(
  asked: string | undefined,
  received: string | undefined,
): string | undefined {
  if (asked === undefined || received === undefined) return undefined;
  if (essenceOf(asked) === essenceOf(received)) return undefined;
  const words = mediaTypeWords(received);
  const sent = words === received ? received : `${words} (${received})`;
  return `Asked for ${mediaTypeWords(asked)}; the service sent ${sent}.`;
}
