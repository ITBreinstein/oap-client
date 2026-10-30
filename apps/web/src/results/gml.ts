/**
 * GML to GeoJSON (#F4): a GML or WFS feature collection, simple features only,
 * read into a GeoJSON FeatureCollection that then takes the GeoJSON path —
 * plotting, the properties panel, `maxCoordinates`, the display limit,
 * download.
 *
 * Simple features: `Point`, `LineString`, `Polygon` (its exterior and every
 * interior), `MultiPoint`, `MultiLineString`, `MultiPolygon`, `MultiSurface`
 * and `MultiCurve` of those; positions in `pos`, `posList`, GML 2's
 * `coordinates` (with its `cs`, `ts` and `decimal`) or `coord`. Anything else
 * — a `Curve` with arcs, a `Surface` of patches, a solid, a `MultiGeometry` —
 * refuses the whole document, which stays as text or a download, with a short
 * reason. Heights are left out, as the map draws none.
 *
 * Both shapes that exist are read the same way: GML 2 as OGR writes it
 * (ZOO-Project's OGR services, an `ogr:FeatureCollection` of
 * `gml:featureMember`s), and GML 3.2 in a WFS 2.0 `wfs:member`.
 *
 * A feature's properties are its simple child elements — those with no
 * elements inside — as text, by local name. Its first child holding a GML
 * geometry is its geometry. `gml:boundedBy` is neither.
 *
 * Where it goes on the map is the geometry's `srsName`, or the nearest
 * enclosing geometry's: never the feature's or the collection's envelope,
 * which describe a box, not the coordinates. Its axis order is the table
 * below, `GML_AXIS_ORDER`, tested row by row. No `srsName` anywhere, and the
 * result is not placed: the coordinates are never guessed at from their size.
 */

import {
  epsgCodeOf,
  knownCrs,
  mapGeoJsonPositions,
  toCrs84,
  type KnownCrs,
  type Placement,
} from "./crs.js";
import { childElements, GML_NAMESPACES, isElement, textOf, WFS_NAMESPACES } from "./xml.js";

type Position = number[];

export type GeoJsonGeometry =
  | { readonly type: "Point"; readonly coordinates: Position }
  | { readonly type: "LineString"; readonly coordinates: Position[] }
  | { readonly type: "Polygon"; readonly coordinates: Position[][] }
  | { readonly type: "MultiPoint"; readonly coordinates: Position[] }
  | { readonly type: "MultiLineString"; readonly coordinates: Position[][] }
  | { readonly type: "MultiPolygon"; readonly coordinates: Position[][][] }
  | { readonly type: "GeometryCollection"; readonly geometries: GeoJsonGeometry[] };

export interface GeoJsonFeature {
  readonly type: "Feature";
  readonly id?: string;
  readonly properties: Record<string, string>;
  readonly geometry: GeoJsonGeometry | null;
}

export interface GeoJsonFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: GeoJsonFeature[];
}

/** How a GML `srsName` orders its axes. */
export type AxisOrder = "longitude-first" | "latitude-first" | "easting-first";

export interface AxisRule {
  /** The spelling, in words. */
  readonly form: string;
  /** One example of it, which the tests check against this row. */
  readonly example: string;
  readonly crs: KnownCrs;
  readonly order: AxisOrder;
}

/**
 * The axis order each spelling of an `srsName` means in GML. EPSG:4326 is
 * latitude first in the EPSG register, and the URN and `def/crs` URI forms
 * say so; GML 2 and OGR write the bare `EPSG:4326` and the `epsg.xml#` form
 * longitude first, as every tool that writes them does. CRS84 is longitude
 * first however written. RD New is easting, northing.
 */
export const GML_AXIS_ORDER: readonly AxisRule[] = [
  {
    form: "EPSG:4326, bare, as GML 2 and OGR write it",
    example: "EPSG:4326",
    crs: "EPSG:4326",
    order: "longitude-first",
  },
  {
    form: "EPSG:4326 in GML 2's epsg.xml form",
    example: "http://www.opengis.net/gml/srs/epsg.xml#4326",
    crs: "EPSG:4326",
    order: "longitude-first",
  },
  {
    form: "EPSG:4326 as a URN",
    example: "urn:ogc:def:crs:EPSG::4326",
    crs: "EPSG:4326",
    order: "latitude-first",
  },
  {
    form: "EPSG:4326 as an OGC def/crs URI",
    example: "http://www.opengis.net/def/crs/EPSG/0/4326",
    crs: "EPSG:4326",
    order: "latitude-first",
  },
  {
    form: "CRS84, however written",
    example: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    crs: "CRS84",
    order: "longitude-first",
  },
  {
    form: "EPSG:28992 (RD New), however written",
    example: "urn:ogc:def:crs:EPSG::28992",
    crs: "EPSG:28992",
    order: "easting-first",
  },
];

/** The row of `GML_AXIS_ORDER` an `srsName` falls under; undefined for any other system. */
export function gmlAxisRule(srsName: string): AxisRule | undefined {
  const crs = knownCrs(srsName);
  const trimmed = srsName.trim();
  switch (crs) {
    case undefined:
      return undefined;
    case "CRS84":
      return GML_AXIS_ORDER[4];
    case "EPSG:28992":
      return GML_AXIS_ORDER[5];
    case "EPSG:4326":
      if (/^urn:/i.test(trimmed)) return GML_AXIS_ORDER[2];
      if (/^https?:\/\/www\.opengis\.net\/def\/crs\//i.test(trimmed)) return GML_AXIS_ORDER[3];
      if (/epsg\.xml#/i.test(trimmed)) return GML_AXIS_ORDER[1];
      return epsgCodeOf(trimmed) === 4326 ? GML_AXIS_ORDER[0] : undefined;
  }
}

/** The coordinate systems a document's geometries name. */
export type GmlSrs =
  /** None names one. */
  { readonly kind: "none" } | { readonly kind: "one"; readonly srsName: string };

export type GmlRead =
  | {
      readonly ok: true;
      /** In the document's own axis order: placing it is `placeGml`'s. */
      readonly geojson: GeoJsonFeatureCollection;
      readonly srs: GmlSrs;
      /** Whether any position had a height, which was left out. */
      readonly heightsDropped: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/** Why a document is not read: said to the user as it is. */
class Refused extends Error {}

const GEOMETRIES = [
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
  "MultiSurface",
  "MultiCurve",
];

function isGml(element: Element, ...names: string[]): boolean {
  return isElement(element, GML_NAMESPACES, ...names);
}

function gmlChildren(element: Element, ...names: string[]): Element[] {
  return childElements(element).filter((child) => isGml(child, ...names));
}

function prefixed(element: Element): string {
  return element.prefix === null ? element.localName : `${element.prefix}:${element.localName}`;
}

/** Everything one read needs to keep: the CRSs named and whether a height was dropped. */
interface Reading {
  readonly srsNames: Set<string | undefined>;
  heightsDropped: boolean;
}

function number(token: string): number {
  const value = token.trim() === "" ? Number.NaN : Number(token);
  if (!Number.isFinite(value)) throw new Refused("One of its coordinates is not a number.");
  return value;
}

function position(values: readonly number[], reading: Reading): Position {
  const [x, y] = values;
  if (x === undefined || y === undefined) {
    throw new Refused("One of its positions has fewer than two coordinates.");
  }
  if (values.length > 2) reading.heightsDropped = true;
  return [x, y];
}

/** `srsDimension` on the element or the nearest geometry around it; 2 when none says. */
function dimensionOf(element: Element): number {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const declared = at.getAttribute("srsDimension");
    if (declared !== null) {
      const dimension = Number(declared);
      if (Number.isInteger(dimension) && dimension >= 2 && dimension <= 4) return dimension;
      throw new Refused(`Its srsDimension "${declared}" is not one this page reads.`);
    }
    if (isGml(at, ...GEOMETRIES)) break;
  }
  return 2;
}

/** GML 2's `coordinates`, with its own separators. */
function fromCoordinates(element: Element, reading: Reading): Position[] {
  const cs = element.getAttribute("cs") ?? ",";
  const ts = element.getAttribute("ts") ?? " ";
  const decimal = element.getAttribute("decimal") ?? ".";
  const text = textOf(element);
  if (text === "") return [];
  const tuples = ts.trim() === "" ? text.split(/\s+/) : text.split(ts).map((tuple) => tuple.trim());
  return tuples
    .filter((tuple) => tuple !== "")
    .map((tuple) =>
      position(
        tuple
          .split(cs)
          .map((token) => number(decimal === "." ? token : token.split(decimal).join("."))),
        reading,
      ),
    );
}

/** GML 2's `coord`: `X`, `Y` and perhaps `Z`. */
function fromCoord(element: Element, reading: Reading): Position {
  const value = (name: string) => {
    const found = gmlChildren(element, name)[0];
    return found === undefined ? undefined : number(textOf(found));
  };
  const x = value("X");
  const y = value("Y");
  if (x === undefined || y === undefined) throw new Refused("A gml:coord without X and Y.");
  if (value("Z") !== undefined) reading.heightsDropped = true;
  return [x, y];
}

function fromNumbers(element: Element, reading: Reading): Position[] {
  const values = textOf(element)
    .split(/\s+/)
    .filter((token) => token !== "")
    .map(number);
  const dimension = dimensionOf(element);
  if (values.length % dimension !== 0) {
    throw new Refused("One of its position lists does not divide into whole positions.");
  }
  const out: Position[] = [];
  for (let at = 0; at < values.length; at += dimension) {
    out.push(position(values.slice(at, at + dimension), reading));
  }
  return out;
}

/** The positions of a `Point`, `LineString` or `LinearRing`, in whichever form they are written. */
function positionsOf(element: Element, reading: Reading): Position[] {
  const out: Position[] = [];
  for (const child of childElements(element)) {
    if (isGml(child, "posList")) out.push(...fromNumbers(child, reading));
    else if (isGml(child, "pos")) {
      const tokens = textOf(child)
        .split(/\s+/)
        .filter((token) => token !== "");
      out.push(position(tokens.map(number), reading));
    } else if (isGml(child, "coordinates")) out.push(...fromCoordinates(child, reading));
    else if (isGml(child, "coord")) out.push(fromCoord(child, reading));
    else if (isGml(child, "pointProperty", "pointRep")) {
      throw new Refused(`It holds a ${prefixed(child)}, which this page does not read.`);
    }
  }
  return out;
}

function atLeast(positions: Position[], count: number, what: string): Position[] {
  if (positions.length < count) {
    throw new Refused(`It holds a ${what} with fewer than ${String(count)} positions.`);
  }
  return positions;
}

/**
 * The `srsName` that applies to a geometry, its own or the one around it,
 * recorded: every geometry that holds positions names one, or none.
 */
function srsOf(
  element: Element,
  inherited: string | undefined,
  reading: Reading,
): string | undefined {
  const applies = element.getAttribute("srsName") ?? inherited;
  reading.srsNames.add(applies);
  return applies;
}

/** One of a `Multi*`'s members, which must be `name`. */
function memberOf(element: Element, name: string): Element {
  if (!isGml(element, name)) {
    throw new Refused(`It holds a ${prefixed(element)}, which this page does not draw.`);
  }
  return element;
}

function pointAt(element: Element, reading: Reading, inherited: string | undefined): Position {
  srsOf(element, inherited, reading);
  const [point, ...more] = positionsOf(memberOf(element, "Point"), reading);
  if (point === undefined || more.length > 0) {
    throw new Refused("It holds a point without exactly one position.");
  }
  return point;
}

function lineAt(element: Element, reading: Reading, inherited: string | undefined): Position[] {
  srsOf(element, inherited, reading);
  return atLeast(positionsOf(memberOf(element, "LineString"), reading), 2, "line");
}

function ring(boundary: Element, reading: Reading): Position[] {
  const [linear, ...others] = childElements(boundary);
  if (linear === undefined || others.length > 0 || !isGml(linear, "LinearRing")) {
    const found = linear === undefined ? "an empty boundary" : prefixed(linear);
    throw new Refused(`It holds a polygon bounded by ${found}, which this page does not read.`);
  }
  return atLeast(positionsOf(linear, reading), 4, "ring");
}

function polygonAt(
  element: Element,
  reading: Reading,
  inherited: string | undefined,
): Position[][] {
  srsOf(element, inherited, reading);
  memberOf(element, "Polygon");
  const exterior = gmlChildren(element, "exterior", "outerBoundaryIs");
  const [outer] = exterior;
  if (outer === undefined || exterior.length > 1) {
    throw new Refused("It holds a polygon without exactly one exterior.");
  }
  const interiors = gmlChildren(element, "interior", "innerBoundaryIs");
  return [ring(outer, reading), ...interiors.map((inner) => ring(inner, reading))];
}

/** The member geometries of a `Multi*`, from its `…Member` and `…Members` children. */
function members(element: Element, member: string): Element[] {
  const out: Element[] = [];
  for (const child of childElements(element)) {
    if (isGml(child, member)) {
      const [inner, ...more] = childElements(child);
      if (inner === undefined || more.length > 0) {
        throw new Refused(`It holds a ${prefixed(child)} without exactly one geometry in it.`);
      }
      out.push(inner);
    } else if (isGml(child, `${member}s`)) out.push(...childElements(child));
  }
  return out;
}

function geometry(element: Element, reading: Reading): GeoJsonGeometry {
  // A Multi*'s own srsName is inherited by its members; it holds no positions itself.
  const around = element.getAttribute("srsName") ?? undefined;
  if (!isGml(element, ...GEOMETRIES)) {
    throw new Refused(`It holds a ${prefixed(element)}, which this page does not draw.`);
  }
  switch (element.localName) {
    case "Point":
      return { type: "Point", coordinates: pointAt(element, reading, undefined) };
    case "LineString":
      return { type: "LineString", coordinates: lineAt(element, reading, undefined) };
    case "Polygon":
      return { type: "Polygon", coordinates: polygonAt(element, reading, undefined) };
    case "MultiPoint":
      return {
        type: "MultiPoint",
        coordinates: members(element, "pointMember").map((m) => pointAt(m, reading, around)),
      };
    case "MultiLineString":
    case "MultiCurve": {
      const member = element.localName === "MultiCurve" ? "curveMember" : "lineStringMember";
      return {
        type: "MultiLineString",
        coordinates: members(element, member).map((m) => lineAt(m, reading, around)),
      };
    }
    case "MultiPolygon":
    case "MultiSurface": {
      const member = element.localName === "MultiSurface" ? "surfaceMember" : "polygonMember";
      return {
        type: "MultiPolygon",
        coordinates: members(element, member).map((m) => polygonAt(m, reading, around)),
      };
    }
    default:
      throw new Refused(`It holds a ${prefixed(element)}, which this page does not draw.`);
  }
}

/** A feature element: its id, its simple children as properties, its first geometry. */
function feature(element: Element, reading: Reading): GeoJsonFeature {
  const properties: Record<string, string> = {};
  let found: GeoJsonGeometry | null = null;
  for (const child of childElements(element)) {
    if (isGml(child, "boundedBy")) continue;
    const inner = childElements(child);
    if (inner.length === 0) {
      if (!(child.localName in properties)) properties[child.localName] = textOf(child);
      continue;
    }
    const [first] = inner;
    if (first === undefined || !GML_NAMESPACES.has(first.namespaceURI ?? "")) continue;
    if (found === null) found = geometry(first, reading);
  }
  const id =
    element.getAttributeNS("http://www.opengis.net/gml/3.2", "id") ??
    element.getAttributeNS("http://www.opengis.net/gml", "id") ??
    element.getAttribute("fid") ??
    undefined;
  return { type: "Feature", ...(id === undefined ? {} : { id }), properties, geometry: found };
}

/** The feature elements of a collection: its feature members, in order. */
function featureElements(root: Element): Element[] {
  const out: Element[] = [];
  for (const child of childElements(root)) {
    if (isGml(child, "featureMember") || isElement(child, WFS_NAMESPACES, "member")) {
      const [inner] = childElements(child);
      if (inner !== undefined) out.push(inner);
    } else if (isGml(child, "featureMembers")) {
      out.push(...childElements(child));
    }
  }
  return out;
}

/** A GML feature collection, read. `root` is what `xml.ts` called `gml`. */
export function readGml(root: Element): GmlRead {
  const reading: Reading = { srsNames: new Set(), heightsDropped: false };
  try {
    const features = featureElements(root).map((element) => feature(element, reading));
    const named = [...reading.srsNames];
    if (named.length > 1) {
      const said = named.map((name) => name ?? "none").join(" and ");
      throw new Refused(`Its geometries name more than one coordinate system (${said}).`);
    }
    const [srsName] = named;
    return {
      ok: true,
      geojson: { type: "FeatureCollection", features },
      srs: srsName === undefined ? { kind: "none" } : { kind: "one", srsName },
      heightsDropped: reading.heightsDropped,
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}

/** Where a read GML document goes on the map, by its `srsName` and `GML_AXIS_ORDER`. */
export async function placeGml(read: Extract<GmlRead, { ok: true }>): Promise<Placement> {
  if (read.srs.kind === "none") return { kind: "unstated", from: "gml-srsname" };
  const uri = read.srs.srsName;
  const rule = gmlAxisRule(uri);
  if (rule === undefined) return { kind: "other", uri, from: "gml-srsname" };
  const convert = await toCrs84(
    rule.order === "latitude-first"
      ? "EPSG:4326"
      : rule.crs === "EPSG:28992"
        ? "EPSG:28992"
        : "CRS84",
  );
  return {
    kind:
      rule.order === "latitude-first"
        ? "swapped"
        : rule.crs === "EPSG:28992"
          ? "reprojected"
          : "crs84",
    crs: rule.crs,
    uri,
    from: "gml-srsname",
    value: mapGeoJsonPositions(read.geojson, convert),
  };
}
