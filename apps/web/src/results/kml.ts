/**
 * KML to GeoJSON (#F5): every `Placemark`, at any depth of `Document` and
 * `Folder`, read into a GeoJSON Feature that then takes the GeoJSON path.
 *
 * Geometry: `Point`, `LineString`, `LinearRing` (as a line), `Polygon` with its
 * outer and inner boundaries, and `MultiGeometry` of those, nested or not.
 * KML's `coordinates` are always longitude, latitude and an optional altitude;
 * the altitude is left out, as the map draws none. A Placemark with anything
 * else — a `Model`, a `gx:Track` — is kept, with no geometry, so its
 * properties are still there.
 *
 * Properties, all as text: `name`, `description`, and `ExtendedData` — each
 * `Data`'s `value` by its `name`, and each `SchemaData`'s `SimpleData` by its
 * `name`. A `description` is often HTML, and stays text here and on screen:
 * nothing in a KML document is ever rendered as markup.
 *
 * KMZ, a zip, is not read: it stays a download.
 */

import type { GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonGeometry } from "./gml.js";
import { childElements, isElement, KML_NAMESPACES, textOf } from "./xml.js";

type Position = number[];

export type KmlRead =
  | {
      readonly ok: true;
      readonly geojson: GeoJsonFeatureCollection;
      /** Whether any position had an altitude, which was left out. */
      readonly heightsDropped: boolean;
    }
  | { readonly ok: false; readonly reason: string };

class Refused extends Error {}

function isKml(element: Element, ...names: string[]): boolean {
  return isElement(element, KML_NAMESPACES, ...names);
}

function kmlChild(element: Element, name: string): Element | undefined {
  return childElements(element).find((child) => isKml(child, name));
}

interface Reading {
  heightsDropped: boolean;
}

/** `lon,lat[,alt] lon,lat[,alt] …`, white space around the commas tolerated. */
function coordinatesOf(element: Element | undefined, reading: Reading): Position[] {
  const holder = element === undefined ? undefined : kmlChild(element, "coordinates");
  if (holder === undefined) throw new Refused("A geometry without coordinates.");
  const text = textOf(holder).replace(/\s*,\s*/g, ",");
  if (text === "") return [];
  return text.split(/\s+/).map((tuple) => {
    const values = tuple.split(",").map((token) => (token === "" ? Number.NaN : Number(token)));
    const [lon, lat] = values;
    if (
      values.length < 2 ||
      values.length > 3 ||
      lon === undefined ||
      lat === undefined ||
      !values.every(Number.isFinite)
    ) {
      throw new Refused(
        `One of its coordinates, "${tuple.slice(0, 40)}", is not longitude,latitude.`,
      );
    }
    if (values.length === 3) reading.heightsDropped = true;
    return [lon, lat];
  });
}

function atLeast(positions: Position[], count: number, what: string): Position[] {
  if (positions.length < count) {
    throw new Refused(`It holds a ${what} with fewer than ${String(count)} positions.`);
  }
  return positions;
}

function boundary(polygon: Element, name: "outerBoundaryIs" | "innerBoundaryIs"): Element[] {
  return childElements(polygon)
    .filter((child) => isKml(child, name))
    .map((holder) => {
      const ring = kmlChild(holder, "LinearRing");
      if (ring === undefined) throw new Refused(`A polygon's ${name} without a LinearRing.`);
      return ring;
    });
}

/** A KML geometry element as GeoJSON; undefined for one this page does not draw. */
function geometry(element: Element, reading: Reading, depth: number): GeoJsonGeometry | undefined {
  if (depth > 8) throw new Refused("Its MultiGeometry is nested too deeply.");
  if (!KML_NAMESPACES.has(element.namespaceURI ?? "")) return undefined;
  switch (element.localName) {
    case "Point": {
      const [point, ...more] = coordinatesOf(element, reading);
      if (point === undefined || more.length > 0) {
        throw new Refused("It holds a point without exactly one position.");
      }
      return { type: "Point", coordinates: point };
    }
    case "LineString":
    case "LinearRing":
      return {
        type: "LineString",
        coordinates: atLeast(coordinatesOf(element, reading), 2, "line"),
      };
    case "Polygon": {
      const [outer, ...extra] = boundary(element, "outerBoundaryIs");
      if (outer === undefined || extra.length > 0) {
        throw new Refused("It holds a polygon without exactly one outer boundary.");
      }
      const rings = [outer, ...boundary(element, "innerBoundaryIs")].map((ring) =>
        atLeast(coordinatesOf(ring, reading), 4, "ring"),
      );
      return { type: "Polygon", coordinates: rings };
    }
    case "MultiGeometry": {
      const geometries = childElements(element)
        .map((child) => geometry(child, reading, depth + 1))
        .filter((found): found is GeoJsonGeometry => found !== undefined);
      return { type: "GeometryCollection", geometries };
    }
    default:
      return undefined;
  }
}

/** `name`, `description` and `ExtendedData`, as text; the first of a name wins. */
function propertiesOf(placemark: Element): Record<string, string> {
  const properties: Record<string, string> = {};
  const set = (name: string | null, value: string) => {
    if (name !== null && name !== "" && !(name in properties)) properties[name] = value;
  };
  const name = kmlChild(placemark, "name");
  if (name !== undefined) set("name", textOf(name));
  const description = kmlChild(placemark, "description");
  if (description !== undefined) set("description", textOf(description));
  const extended = kmlChild(placemark, "ExtendedData");
  if (extended !== undefined) {
    for (const child of childElements(extended)) {
      if (isKml(child, "Data")) {
        const value = kmlChild(child, "value");
        set(child.getAttribute("name"), value === undefined ? "" : textOf(value));
      } else if (isKml(child, "SchemaData")) {
        for (const simple of childElements(child)) {
          if (isKml(simple, "SimpleData")) set(simple.getAttribute("name"), textOf(simple));
        }
      }
    }
  }
  return properties;
}

const GEOMETRY_NAMES = ["Point", "LineString", "LinearRing", "Polygon", "MultiGeometry"];

function placemark(element: Element, reading: Reading): GeoJsonFeature {
  const shape = childElements(element).find((child) => isKml(child, ...GEOMETRY_NAMES));
  const read = shape === undefined ? undefined : geometry(shape, reading, 0);
  const id = element.getAttribute("id");
  return {
    type: "Feature",
    ...(id === null ? {} : { id }),
    properties: propertiesOf(element),
    geometry: read ?? null,
  };
}

/** A KML document, read. `root` is what `xml.ts` called `kml`. */
export function readKml(root: Element): KmlRead {
  const reading: Reading = { heightsDropped: false };
  try {
    const placemarks = Array.from(root.getElementsByTagName("*")).filter((element) =>
      isKml(element, "Placemark"),
    );
    const features = placemarks.map((element) => placemark(element, reading));
    return {
      ok: true,
      geojson: { type: "FeatureCollection", features },
      heightsDropped: reading.heightsDropped,
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}
