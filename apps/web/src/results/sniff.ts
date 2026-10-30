/**
 * What a result turned out to be, when its label and its bytes disagree, and
 * GML or KML read for the map (#F4, #F5).
 *
 * Sniffing is narrow on purpose (§11 of the brief). It runs only on a body
 * labelled JSON that does not parse as JSON — ZOO-Project labels every raw
 * answer `application/json` (finding 0026), GML, KML and TIFF alike — and only
 * after the size limits. It looks at the bytes first, for a closed list:
 *
 * - TIFF (`II*\0` or `MM\0*`), PNG and JPEG, by their magic bytes;
 * - XML whose root is a GML or WFS feature collection, or `kml`.
 *
 * Anything else is handled as before. HTML is never sniffed into. An output
 * whose description declares base64 and whose body is none of these is tried
 * as base64 once, and the decoded bytes are looked at the same way.
 *
 * A body labelled as XML or GML or KML is read for the map without sniffing:
 * its label already says what to look for. Either way the label is kept, and
 * what was found is recorded beside it (`observations.ts`).
 */

import type { Placement } from "./crs.js";
import { placeGml, readGml } from "./gml.js";
import type { GeoJsonFeatureCollection } from "./gml.js";
import { readKml } from "./kml.js";
import { looksLikeXml, parseXml, rootKind, type XmlRefusal } from "./xml.js";

/** What a result was read as for the map. */
export type ParsedAs = "gml" | "kml";

/** A GML or KML result, read for the map, or refused with a reason in words. */
export type GeoRead =
  | {
      readonly ok: true;
      readonly parsedAs: ParsedAs;
      /** As read: in the document's own coordinate system and axis order. */
      readonly geojson: GeoJsonFeatureCollection;
      readonly placement: Placement;
      readonly heightsDropped: boolean;
    }
  | { readonly ok: false; readonly parsedAs: ParsedAs; readonly reason: string };

/** What sniffing found. */
export type SniffedKind = "tiff" | "png" | "jpeg" | ParsedAs;

export const SNIFFED_MEDIA_TYPES: Readonly<Record<SniffedKind, string>> = {
  tiff: "image/tiff",
  png: "image/png",
  jpeg: "image/jpeg",
  gml: "application/gml+xml",
  kml: "application/vnd.google-earth.kml+xml",
};

/** A body whose label said one thing and whose bytes another. */
export interface Sniffed {
  readonly kind: SniffedKind;
  /** The media type the response or entry was labelled with, verbatim. */
  readonly declaredMediaType: string;
  /** Present when the bytes were base64 to be decoded first. */
  readonly base64?: true | undefined;
}

/** TIFF, PNG or JPEG by their first bytes; undefined for anything else. */
export function magicOf(bytes: Uint8Array): "tiff" | "png" | "jpeg" | undefined {
  const at = (index: number) => bytes[index];
  if (
    bytes.length >= 4 &&
    ((at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a && at(3) === 0x00) ||
      (at(0) === 0x4d && at(1) === 0x4d && at(2) === 0x00 && at(3) === 0x2a))
  ) {
    return "tiff";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, index) => at(index) === byte)) return "png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  return undefined;
}

/** Base64 text as bytes, only when every character is base64 and it decodes. */
export function base64Bytes(text: string): Uint8Array | undefined {
  const compact = text.replace(/\s+/g, "");
  if (compact === "" || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return undefined;
  }
  try {
    const binary = atob(compact);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

const REFUSALS: Readonly<Record<XmlRefusal, string>> = {
  "not-xml": "It is not well-formed XML.",
  doctype: "It declares a DOCTYPE, which this page does not read.",
  html: "It is HTML, which this page does not read as data.",
};

/** The format a media type's label claims, for reading: GML, KML, XML of any kind, or none. */
export function xmlLabel(mediaType: string | undefined): ParsedAs | "xml" | undefined {
  if (mediaType === undefined) return undefined;
  const essence = (mediaType.split(";")[0] ?? "").trim().toLowerCase();
  if (essence === "application/gml+xml") return "gml";
  if (essence === "application/vnd.google-earth.kml+xml") return "kml";
  if (essence === "text/xml" || essence === "application/xml" || essence.endsWith("+xml")) {
    return "xml";
  }
  return undefined;
}

/** A GML or KML root, read and placed. */
async function readRoot(root: Element, kind: ParsedAs): Promise<GeoRead> {
  if (kind === "kml") {
    const read = readKml(root);
    if (!read.ok) return { ok: false, parsedAs: "kml", reason: read.reason };
    return {
      ok: true,
      parsedAs: "kml",
      geojson: read.geojson,
      // KML is longitude and latitude by definition: nothing to read, nothing to change.
      placement: {
        kind: "crs84",
        crs: "CRS84",
        uri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        from: "kml",
        value: read.geojson,
      },
      heightsDropped: read.heightsDropped,
    };
  }
  const read = readGml(root);
  if (!read.ok) return { ok: false, parsedAs: "gml", reason: read.reason };
  return {
    ok: true,
    parsedAs: "gml",
    geojson: read.geojson,
    placement: await placeGml(read),
    heightsDropped: read.heightsDropped,
  };
}

/**
 * A text labelled as XML, GML or KML, read for the map. Undefined when it is
 * neither GML nor KML and its label did not say it would be: then it is
 * text, as before. Labelled GML or KML and not that, it is refused, with why.
 */
export async function readLabelledXml(
  text: string,
  mediaType: string | undefined,
): Promise<GeoRead | undefined> {
  const label = xmlLabel(mediaType);
  if (label === undefined) return undefined;
  const parsed = parseXml(text);
  if (!parsed.ok) {
    return label === "xml"
      ? undefined
      : { ok: false, parsedAs: label, reason: REFUSALS[parsed.reason] };
  }
  const kind = rootKind(parsed.root);
  if (kind === "other") {
    if (label === "xml") return undefined;
    const reason =
      label === "gml"
        ? "Labelled GML, but it is not a GML feature collection."
        : "Labelled KML, but it is not a KML document.";
    return { ok: false, parsedAs: label, reason };
  }
  return readRoot(parsed.root, kind);
}

/**
 * A text labelled JSON that is not JSON: GML or KML when its root says so,
 * read for the map. Undefined for anything else, HTML included.
 */
export async function sniffXml(text: string): Promise<GeoRead | undefined> {
  if (!looksLikeXml(text)) return undefined;
  const parsed = parseXml(text);
  if (!parsed.ok) return undefined;
  const kind = rootKind(parsed.root);
  return kind === "other" ? undefined : readRoot(parsed.root, kind);
}
