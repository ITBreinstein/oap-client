/**
 * Just enough CRS knowledge to send a map-drawn bounding box honestly (T9).
 *
 * The trap: CRS84 is longitude, latitude; EPSG:4326 is officially *latitude*,
 * longitude. The map binding always hands back CRS84 order, so the encoder has
 * to know which of the server's CRSs it is sending in, and swap when that is
 * EPSG:4326. Nothing here reprojects — a projected CRS is recognised only so
 * that the form can say it cannot draw one (reprojection is a later decision).
 *
 * Recognition is by URI form, and every form the testbed or the standard uses
 * is accepted: the OGC `http://www.opengis.net/def/crs/…` URIs, the OGC URNs
 * (with or without a version, `urn:ogc:def:crs:EPSG:6.6:4326` being ZOO's),
 * and the bare `EPSG:4326` shorthand.
 */

export const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
export const CRS84H = "http://www.opengis.net/def/crs/OGC/0/CRS84h";

export type CrsKind =
  /** Longitude, latitude. What the map binding produces. */
  | "crs84"
  /** CRS84 with height: six numbers, which a map-drawn box does not have. */
  | "crs84h"
  /** Latitude, longitude: the same numbers as CRS84, swapped. */
  | "epsg4326"
  /** Any other EPSG code. Treated as projected: typed coordinates only. */
  | "other-epsg"
  | "unknown";

const OGC_CRS84 = /(?:^|[/:])CRS84$/i;
const OGC_CRS84H = /(?:^|[/:])CRS84h$/i;
// EPSG/0/4326, EPSG::4326, EPSG:6.6:4326, EPSG:4326 — the code is the last number.
const EPSG_CODE = /EPSG(?:\/[\d.]+\/|:[\d.]*:|:)(\d+)$/i;

export function epsgCode(uri: string): number | undefined {
  const match = EPSG_CODE.exec(uri.trim());
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export function classifyCrs(uri: string): CrsKind {
  const trimmed = uri.trim();
  if (OGC_CRS84H.test(trimmed)) return "crs84h";
  if (OGC_CRS84.test(trimmed)) return "crs84";
  const code = epsgCode(trimmed);
  if (code === 4326) return "epsg4326";
  if (code !== undefined) return "other-epsg";
  return "unknown";
}

/** A CRS a map-drawn, four-number, CRS84-ordered box can be sent in. */
export function isDrawableCrs(uri: string): boolean {
  const kind = classifyCrs(uri);
  return kind === "crs84" || kind === "epsg4326";
}

/**
 * The CRS to send a map-drawn box in: CRS84 when the server offers it, else
 * EPSG:4326 (and the encoder swaps), else none — a projected-only input cannot
 * be drawn without reprojecting, and this client does not reproject.
 */
export function drawableCrs(offered: readonly string[]): string | undefined {
  return (
    offered.find((uri) => classifyCrs(uri) === "crs84") ??
    offered.find((uri) => classifyCrs(uri) === "epsg4326")
  );
}
