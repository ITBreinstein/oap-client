/**
 * What was sent, in words: one line per input for the record shown after a
 * run ("Inputs you sent"), in place of the form's controls, which only looked
 * clickable once disabled.
 *
 * Pure, so the wording is tested without React. A line is a list of parts,
 * each in the UI face or in mono (numbers, coordinates, identifiers, links,
 * file names); a value longer than a line also carries its exact text, for a
 * "Show the value" fold.
 */

import type { ProcessDescription } from "@breinstein/oap-client";
import { classifyCrs } from "../forms/crs.js";
import { isAbsentFor, isGeoJsonText, isRawJson } from "../forms/encode.js";
import { isJsonArray, isJsonObject } from "../forms/json.js";
import type { Control, FieldPlan, FormPlan } from "../forms/plan.js";
import { offersLink } from "./run.js";

export interface SummaryPart {
  readonly text: string;
  /** Set in the mono face: a number, coordinates, an identifier, a link, a file name. */
  readonly mono?: true | undefined;
}

export interface Summary {
  readonly parts: readonly SummaryPart[];
  /** The exact value, when it is longer than one line: JSON, GeoJSON, long text. */
  readonly full?: string | undefined;
}

export interface SummaryContext {
  /** The map draws this value, as the input's dashed outline. */
  readonly onMap?: boolean | undefined;
  /** The run has finished: a linked value has been fetched, not "is being". */
  readonly done?: boolean | undefined;
}

/** A list says this many of its items, then how many more there are. */
export const LIST_SHOWN = 5;

/** Longer than this, or on more than one line, a text value also folds out whole. */
const ONE_LINE = 80;

const ON_MAP = "Shown on the map as the dashed outline.";

const plain = (text: string): SummaryPart => ({ text });
const mono = (text: string): SummaryPart => ({ text, mono: true });

/** The summary's words as one string: for a list's items, and for tests. */
export function summaryText(summary: Summary): string {
  return summary.parts.map((part) => part.text).join("");
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** How many bytes base64 text stands for. */
function base64Bytes(text: string): number {
  const clean = text.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** "640 bytes", "2.3 kB", "12 kB", "1.4 MB". */
export function sizeInWords(bytes: number): string {
  const scaled = (value: number, unit: string) =>
    `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${unit}`;
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return scaled(bytes / 1024, "kB");
  return scaled(bytes / (1024 * 1024), "MB");
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function isLong(text: string): boolean {
  return text.includes("\n") || text.length > ONE_LINE;
}

// --------------------------------------------------------------- GeoJSON

type Positions = readonly unknown[];

/** A ring's corners: its positions less the closing one that repeats the first. */
function corners(ring: unknown): number {
  if (!Array.isArray(ring)) return 0;
  const positions: Positions = ring;
  const first = positions[0];
  const last = positions.at(-1);
  const closed = positions.length > 1 && JSON.stringify(first) === JSON.stringify(last) ? 1 : 0;
  return positions.length - closed;
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  Point: "points",
  MultiPoint: "points",
  LineString: "lines",
  MultiLineString: "lines",
  Polygon: "polygons",
  MultiPolygon: "polygons",
  GeometryCollection: "geometry collections",
};

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** A geometry's type and size: "Polygon, 5 points", "MultiPolygon, 3 polygons". */
function describeGeometry(geometry: Record<string, unknown>): string | undefined {
  const type = geometry["type"];
  const coordinates = geometry["coordinates"];
  const count = Array.isArray(coordinates) ? coordinates.length : 0;
  switch (type) {
    case "Point":
      return "Point";
    case "MultiPoint":
      return `MultiPoint, ${plural(count, "point", "points")}`;
    case "LineString":
      return `LineString, ${plural(count, "point", "points")}`;
    case "MultiLineString":
      return `MultiLineString, ${plural(count, "line", "lines")}`;
    case "Polygon": {
      const rings: Positions = Array.isArray(coordinates) ? coordinates : [];
      const points = rings.reduce<number>((sum, ring) => sum + corners(ring), 0);
      return `Polygon, ${plural(points, "point", "points")}`;
    }
    case "MultiPolygon":
      return `MultiPolygon, ${plural(count, "polygon", "polygons")}`;
    case "GeometryCollection": {
      const geometries = geometry["geometries"];
      const members = Array.isArray(geometries) ? geometries.length : 0;
      return `GeometryCollection, ${plural(members, "geometry", "geometries")}`;
    }
    default:
      return undefined;
  }
}

/**
 * GeoJSON's type and size in words: "Polygon, 5 points", "Feature: Polygon,
 * 5 points", "FeatureCollection, 6 features (polygons)". Undefined for text
 * that is not GeoJSON.
 */
export function describeGeoJson(text: string): string | undefined {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isJsonObject(document)) return undefined;
  if (document["type"] === "Feature") {
    const geometry = document["geometry"];
    const inner = isJsonObject(geometry) ? describeGeometry(geometry) : undefined;
    return inner === undefined ? "Feature, no geometry" : `Feature: ${inner}`;
  }
  if (document["type"] === "FeatureCollection") {
    const features = isJsonArray(document["features"]) ? document["features"] : [];
    const kinds = [
      ...new Set(
        features.map((feature) => {
          const geometry = isJsonObject(feature) ? feature["geometry"] : undefined;
          const type = isJsonObject(geometry) ? geometry["type"] : undefined;
          return (typeof type === "string" ? KIND_WORDS[type] : undefined) ?? "no geometry";
        }),
      ),
    ];
    const size = plural(features.length, "feature", "features");
    return kinds.length === 0
      ? `FeatureCollection, ${size}`
      : `FeatureCollection, ${size} (${joinWords(kinds)})`;
  }
  return describeGeometry(document);
}

// ------------------------------------------------------------- the kinds

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value === undefined ? "" : JSON.stringify(value);
}

function readString(record: unknown, key: string): string | undefined {
  if (!isJsonObject(record)) return undefined;
  const text = record[key];
  return typeof text === "string" ? text : undefined;
}

/** Text formats that hold an identifier rather than words: set in mono. */
const IDENTIFIER_FORMATS: ReadonlySet<string> = new Set([
  "uri",
  "uri-reference",
  "iri",
  "iri-reference",
  "uuid",
  "email",
  "date",
  "date-time",
  "time",
]);

/** The words for one value held by `control`. */
function summariseControl(control: Control, value: unknown, context: SummaryContext): Summary {
  switch (control.kind) {
    case "text": {
      const text = asText(value);
      const identifier = control.format !== undefined && IDENTIFIER_FORMATS.has(control.format);
      if (!isLong(text)) return { parts: [identifier ? mono(text) : plain(text)] };
      const firstLine = text.split("\n", 1)[0] ?? "";
      const lines = text.split("\n").length;
      const lead =
        lines > 1
          ? `${plural(lines, "line", "lines")}, starting “${firstLine.slice(0, ONE_LINE)}”`
          : `${text.slice(0, ONE_LINE)}…`;
      return { parts: [plain(lead)], full: text };
    }
    case "number":
      return { parts: [mono(asText(value).trim())] };
    case "select": {
      const option = control.options.find(
        (candidate) =>
          candidate.value === value || JSON.stringify(candidate.value) === JSON.stringify(value),
      );
      return { parts: [plain(option?.label ?? asText(value))] };
    }
    case "checkbox":
      return { parts: [plain(value === true || value === "true" ? "Yes" : "No")] };
    case "list": {
      const items: readonly unknown[] = Array.isArray(value) ? value : [value];
      const sent = items.filter((item) => !isAbsentFor(control.item, item));
      const shown = sent
        .slice(0, LIST_SHOWN)
        .map((item) => summaryText(summariseControl(control.item, item, {})));
      const more = sent.length - shown.length;
      const words = shown.join(", ") + (more > 0 ? ` + ${String(more)} more` : "");
      const itemMono = control.item.kind === "number" || control.item.kind === "bbox";
      return { parts: [itemMono ? mono(words) : plain(words)] };
    }
    case "bbox": {
      const coordinates =
        isJsonObject(value) && isJsonArray(value["coordinates"]) ? value["coordinates"] : [];
      const half = coordinates.length / 2;
      const corner = (from: number) =>
        coordinates
          .slice(from, from + half)
          .map(asText)
          .join(", ");
      const crs = readString(value, "crs") ?? "";
      const kind = crs === "" ? "crs84" : classifyCrs(crs);
      const wgs84 = kind === "crs84" || kind === "crs84h" || kind === "epsg4326";
      return {
        parts: [
          mono(`${corner(0)} – ${corner(half)}`),
          ...(wgs84 ? [] : [plain(", in "), mono(crs)]),
        ],
      };
    }
    case "geometry": {
      const text = isGeoJsonText(value) ? value.geojson : asText(value);
      const words = describeGeoJson(text) ?? `GeoJSON, ${sizeInWords(utf8Bytes(text))}`;
      return {
        parts: [plain(words), ...(context.onMap === true ? [plain(`. ${ON_MAP}`)] : [plain(".")])],
        full: text,
      };
    }
    case "complex": {
      const format =
        control.formats[
          isJsonObject(value) && typeof value["format"] === "number" ? value["format"] : 0
        ];
      const href = readString(value, "href")?.trim();
      if (href !== undefined && href !== "") {
        const fetched = context.done === true ? "the service fetched it" : "the service fetches it";
        return { parts: [plain("By link: "), mono(href), plain(` (${fetched})`)] };
      }
      const text = readString(value, "value") ?? "";
      const base64 = format?.encoding?.toLowerCase() === "base64";
      const size = sizeInWords(base64 ? base64Bytes(text) : utf8Bytes(text));
      const file = readString(value, "file");
      const how =
        file === undefined
          ? [
              plain(
                `Inline, as ${format?.object === true ? "a JSON object" : (format?.label ?? "text")} (${size})`,
              ),
            ]
          : [plain("From a file: "), mono(file), plain(` (${size})`)];
      const geojson = format?.object === true ? describeGeoJson(text) : undefined;
      return {
        parts: [
          ...how,
          ...(geojson === undefined ? [] : [plain(`: ${geojson}`)]),
          plain("."),
          ...(context.onMap === true ? [plain(` ${ON_MAP}`)] : []),
        ],
        ...(base64 || !isLong(text) ? {} : { full: text }),
      };
    }
    case "json": {
      const text = isRawJson(value)
        ? value.rawJson
        : value === undefined
          ? ""
          : JSON.stringify(value, null, 2);
      return { parts: [plain(`JSON, ${sizeInWords(utf8Bytes(text))}`)], full: text };
    }
  }
}

/** One input's value, in words. */
export function summarise(field: FieldPlan, value: unknown, context: SummaryContext = {}): Summary {
  return summariseControl(field.control, value, context);
}

/** Whether this field's value went into the request. */
export function wasSent(field: FieldPlan, value: unknown): boolean {
  return !isAbsentFor(field.control, value);
}

/** The closing line for what was left out: "Not sent: Message (optional, left empty)." */
export function notSentLine(
  plan: FormPlan,
  values: Readonly<Record<string, unknown>>,
): string | undefined {
  const left = plan.fields.filter(
    (field) => !wasSent(field, Object.hasOwn(values, field.id) ? values[field.id] : undefined),
  );
  if (left.length === 0) return undefined;
  const words = left.map(
    (field) => `${field.title} (${field.required ? "required" : "optional"}, left empty)`,
  );
  return `Not sent: ${words.join(", ")}.`;
}

// --------------------------------------------------------------- outputs

const FORMAT_WORDS: Readonly<Record<string, string>> = {
  "application/geo+json": "GeoJSON",
  "application/json": "JSON",
  "text/csv": "CSV",
  "text/plain": "text",
  "text/html": "HTML",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/tiff": "TIFF",
  "application/xml": "XML",
  "text/xml": "XML",
};

function formatWord(mediaType: string): string {
  return FORMAT_WORDS[mediaType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? mediaType;
}

/**
 * How each output was asked for, when the form offered the choice (or the
 * developer view did): "buildings as GeoJSON, by value". Undefined when there
 * was no choice to record.
 */
export function outputsLine(
  process: ProcessDescription,
  linkOutputs: readonly string[],
  developer: boolean,
): string | undefined {
  const allowed = offersLink(process);
  if (process.outputs.length === 0 || (!allowed && !developer)) return undefined;
  const words = process.outputs.map((output) => {
    const mediaType = output.schema["contentMediaType"];
    const as = typeof mediaType === "string" ? ` as ${formatWord(mediaType)}` : "";
    const link = linkOutputs.includes(output.id);
    const how = link ? (allowed ? "by link" : "by link, asked beyond the description") : "by value";
    return `${output.title ?? output.id}${as}, ${how}`;
  });
  return `${words.join("; ")}.`;
}
