/**
 * The coordinate systems a result can name that this page can put on the map
 * (#F1), and how: CRS84 as it is, EPSG:4326 with its axes swapped, EPSG:28992
 * (RD New) reprojected. Exactly these three. Any other CRS is not placed, and
 * the result says so, as before.
 *
 * Each is recognised in every spelling the testbed's servers and the
 * standards use: `EPSG:28992`, `urn:ogc:def:crs:EPSG::28992` (with or without
 * a version), `http://www.opengis.net/def/crs/EPSG/0/28992` (or `https://`),
 * and GML's `http://www.opengis.net/gml/srs/epsg.xml#28992`. Recognising the
 * system is not deciding its axis order: for GeoJSON with a `Content-Crs`,
 * EPSG:4326 is latitude first, as the EPSG register has it; GML writes some
 * spellings longitude first, and that is the GML parser's rule, not this one.
 *
 * Where a CRS comes from is recorded beside it. In this phase, only a
 * response's `Content-Crs`. A result with no CRS named is never guessed at
 * from the size of its numbers: RD New metres sent with nothing to say so
 * stay off the map, and the result says the service did not say.
 *
 * Nothing is looked up over the network. The one projection is defined here,
 * and `proj4` is loaded only when a result needs it, so a page that never
 * meets RD New never downloads it.
 */

/** The three systems this page places. */
export type KnownCrs = "CRS84" | "EPSG:4326" | "EPSG:28992";

/** Where a result's CRS was read from. Later phases add GML's `srsName` and GeoTIFF's geokeys. */
export type CrsSource = "content-crs";

const OGC_CRS84 =
  /^(?:https?:\/\/www\.opengis\.net\/def\/crs\/OGC\/[\d.]+\/|urn:ogc:def:crs:OGC:[\d.]*:|OGC:)?CRS84$/i;
// EPSG/0/4326 · EPSG::4326 · EPSG:6.6:4326 · EPSG:4326 · epsg.xml#4326
const EPSG_FORMS =
  /^(?:https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/[\d.]+\/(\d+)|urn:ogc:def:crs:EPSG:[\d.]*:(\d+)|EPSG:(\d+)|https?:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#(\d+))$/i;

/** The EPSG code a URI names, in any of the spellings above; undefined otherwise. */
export function epsgCodeOf(uri: string): number | undefined {
  const match = EPSG_FORMS.exec(uri.trim());
  if (match === null) return undefined;
  const digits = match[1] ?? match[2] ?? match[3] ?? match[4];
  return digits === undefined ? undefined : Number(digits);
}

/** Which of the three a URI names; undefined for any other system, or none. */
export function knownCrs(uri: string): KnownCrs | undefined {
  const trimmed = uri.trim();
  if (OGC_CRS84.test(trimmed)) return "CRS84";
  const code = epsgCodeOf(trimmed);
  if (code === 4326) return "EPSG:4326";
  if (code === 28992) return "EPSG:28992";
  return undefined;
}

/**
 * RD New, as PDOK reprojects it: Amersfoort / RD New with the seven-parameter
 * shift to WGS 84. Against PDOK's own BAG answers in EPSG:28992 and CRS84,
 * 600 buildings in six areas of the country, the largest difference was
 * 0.18 mm — the RD coordinates' own rounding. Without `+towgs84` it is 112 m.
 *
 * The Netherlands' official transformation, RDNAPTRANS™, uses a correction
 * grid and can differ from this seven-parameter approximation by decimetres.
 * For putting a result on a web map that is far below what can be seen.
 */
export const RD_NEW_PROJ4 =
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 " +
  "+x_0=155000 +y_0=463000 +ellps=bessel " +
  "+towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs";

/** One position from a known system to CRS84, longitude first. Extra members (a height) are kept. */
export type ToCrs84 = (position: readonly number[]) => number[];

function swapped([first = 0, second = 0, ...rest]: readonly number[]): number[] {
  return [second, first, ...rest];
}

/**
 * The function that takes a position in `crs` to CRS84. Asynchronous only
 * because RD New loads `proj4` on first use.
 */
export async function toCrs84(crs: KnownCrs): Promise<ToCrs84> {
  switch (crs) {
    case "CRS84":
      return (position) => [...position];
    case "EPSG:4326":
      return swapped;
    case "EPSG:28992": {
      const { default: proj4 } = await import("proj4");
      const converter = proj4(RD_NEW_PROJ4, "WGS84");
      return ([x = 0, y = 0, ...rest]) => {
        const [lon = Number.NaN, lat = Number.NaN] = converter.forward([x, y]);
        return [lon, lat, ...rest];
      };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((member) => typeof member === "number" && Number.isFinite(member))
  );
}

/** `coordinates` at any depth: a position, or arrays of them. Anything else is kept as sent. */
function mapCoordinates(value: unknown, convert: ToCrs84): unknown {
  if (isPosition(value)) return convert(value);
  if (Array.isArray(value)) return value.map((entry: unknown) => mapCoordinates(entry, convert));
  return value;
}

const GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

/**
 * A GeoJSON value — a FeatureCollection, a Feature, a geometry or a
 * GeometryCollection — with every position converted, and every other member
 * kept as it was. Only geometries are touched: a feature's properties and a
 * `bbox` are the server's, and stay as sent. A value that is not GeoJSON comes
 * back unchanged; whether it can be plotted is still `plottable.ts`'s to say.
 */
export function mapGeoJsonPositions(value: unknown, convert: ToCrs84): unknown {
  if (Array.isArray(value))
    return value.map((entry: unknown) => mapGeoJsonPositions(entry, convert));
  if (!isRecord(value)) return value;
  const type = value["type"];
  if (typeof type === "string" && GEOMETRY_TYPES.has(type)) {
    return { ...value, coordinates: mapCoordinates(value["coordinates"], convert) };
  }
  if (type === "GeometryCollection") {
    return { ...value, geometries: mapGeoJsonPositions(value["geometries"], convert) };
  }
  if (type === "Feature") {
    return { ...value, geometry: mapGeoJsonPositions(value["geometry"], convert) };
  }
  if (type === "FeatureCollection") {
    return { ...value, features: mapGeoJsonPositions(value["features"], convert) };
  }
  return value;
}

/** `<http://…/CRS84>` → `http://…/CRS84`: a `Content-Crs` without its angle brackets. */
export function readContentCrs(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const bare = header.trim().replace(/^<\s*/, "").replace(/\s*>$/, "");
  return bare === "" ? undefined : bare;
}

/**
 * How a GeoJSON result is placed on the map, from the CRS it names (#F1).
 *
 * - `as-sent`: no CRS named. Plotted when its numbers are longitude and
 *   latitude; otherwise the result says the service did not say which system
 *   they are in.
 * - `crs84`, `swapped`, `reprojected`: one of the three; `value` is the GeoJSON
 *   in CRS84 to plot. The result as shown stays as the server sent it.
 * - `other`: a CRS this page does not place.
 */
export type Placement =
  | { readonly kind: "as-sent" }
  | {
      readonly kind: "crs84" | "swapped" | "reprojected";
      readonly crs: KnownCrs;
      readonly uri: string;
      readonly from: CrsSource;
      readonly value: unknown;
    }
  | { readonly kind: "other"; readonly uri: string; readonly from: CrsSource };

/** Where a GeoJSON value with this `Content-Crs` (bare, no brackets) goes on the map. */
export async function placeGeoJson(
  value: unknown,
  uri: string | undefined,
  from: CrsSource,
): Promise<Placement> {
  if (uri === undefined) return { kind: "as-sent" };
  const crs = knownCrs(uri);
  if (crs === undefined) return { kind: "other", uri, from };
  const placed = mapGeoJsonPositions(value, await toCrs84(crs));
  const kind = crs === "CRS84" ? "crs84" : crs === "EPSG:4326" ? "swapped" : "reprojected";
  return { kind, crs, uri, from, value: placed };
}
