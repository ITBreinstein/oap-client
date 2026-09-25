/**
 * Shapes drawn or loaded, turned into the GeoJSON an input accepts — and back.
 *
 * The map draws one shape at a time: a point, a line, an area. What a process
 * wants is stated in the plan: a bare geometry, a Feature or a
 * FeatureCollection, of some geometry types. This is where the two meet, with
 * no guessing beyond the plan: several polygons become a MultiPolygon only
 * when the input accepts one, and whatever does not fit is counted, so the
 * field can say what was left out rather than drop it silently.
 */

import { shapesIn, type Shape, type ShapeType } from "./geojson.js";
import { isJsonObject, type JsonObject } from "./json.js";
import type { GeometryType, GeometryWrapper } from "./plan.js";

/** What an input takes: the wrapper, and which geometry types. */
export interface GeometryTarget {
  readonly wrapper: GeometryWrapper;
  readonly geometryTypes: readonly GeometryType[];
}

const EVERY_GEOMETRY: readonly GeometryType[] = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
];

/**
 * A complex input's JSON-object format, when the user chooses to draw for it.
 * The description says only "an object", so the most general GeoJSON is sent:
 * a FeatureCollection, which is what a GDAL/OGR-based process reads, and what
 * the captured SAGA request that ZOO accepted carried.
 */
export const ANY_FEATURE_COLLECTION: GeometryTarget = {
  wrapper: "feature-collection",
  geometryTypes: EVERY_GEOMETRY,
};

const MULTI: Readonly<Record<ShapeType, GeometryType>> = {
  Point: "MultiPoint",
  LineString: "MultiLineString",
  Polygon: "MultiPolygon",
};

/** Which shapes the drawing tools should offer for this input. */
export function drawableTypes(target: GeometryTarget): readonly ShapeType[] {
  const accepts = (type: GeometryType) => target.geometryTypes.includes(type);
  const collection = accepts("GeometryCollection");
  return (["Point", "LineString", "Polygon"] as const).filter(
    (type) => collection || accepts(type) || accepts(MULTI[type]),
  );
}

/** Whether the input can hold more than one shape. Otherwise a new one replaces it. */
export function holdsSeveral(target: GeometryTarget): boolean {
  return (
    target.wrapper === "feature-collection" ||
    target.geometryTypes.some((type) => type === "GeometryCollection" || type.startsWith("Multi"))
  );
}

export interface Shaped {
  /** The GeoJSON to put in the field; undefined when nothing usable is left. */
  readonly geojson: JsonObject | undefined;
  /** How many shapes it carries. */
  readonly used: number;
  /** Shapes left out, by type: the wrong type, or one too many. */
  readonly ignored: Readonly<Record<string, number>>;
}

interface Combined {
  readonly geometry: JsonObject | undefined;
  readonly used: readonly Shape[];
}

function combine(target: GeometryTarget, shapes: readonly Shape[]): Combined {
  const accepts = (type: GeometryType) => target.geometryTypes.includes(type);
  const [first] = shapes;
  if (first === undefined) return { geometry: undefined, used: [] };

  if (shapes.length === 1 && accepts(first.type)) return { geometry: first, used: shapes };
  const sameType = shapes.every((shape) => shape.type === first.type);
  if (sameType && accepts(MULTI[first.type])) {
    return {
      geometry: { type: MULTI[first.type], coordinates: shapes.map((shape) => shape.coordinates) },
      used: shapes,
    };
  }
  if (accepts("GeometryCollection")) {
    return { geometry: { type: "GeometryCollection", geometries: shapes }, used: shapes };
  }
  // One shape of a type the input takes on its own, and nothing else.
  const single = shapes.find((shape) => accepts(shape.type)) ?? first;
  return {
    geometry: accepts(single.type)
      ? single
      : { type: MULTI[single.type], coordinates: [single.coordinates] },
    used: [single],
  };
}

/** The GeoJSON for these shapes, in the input's wrapper. */
export function toGeoJson(target: GeometryTarget, shapes: readonly Shape[]): Shaped {
  const drawable = new Set(drawableTypes(target));
  const usable = shapes.filter((shape) => drawable.has(shape.type));
  const ignored: Record<string, number> = {};
  const count = (shape: Shape) => {
    ignored[shape.type] = (ignored[shape.type] ?? 0) + 1;
  };
  for (const shape of shapes) if (!drawable.has(shape.type)) count(shape);

  if (target.wrapper === "feature-collection") {
    return {
      geojson:
        usable.length === 0
          ? undefined
          : {
              type: "FeatureCollection",
              features: usable.map((geometry) => ({ type: "Feature", properties: {}, geometry })),
            },
      used: usable.length,
      ignored,
    };
  }

  const { geometry, used } = combine(target, usable);
  for (const shape of usable) if (!used.includes(shape)) count(shape);
  return {
    geojson:
      geometry === undefined
        ? undefined
        : target.wrapper === "feature"
          ? { type: "Feature", properties: {}, geometry }
          : geometry,
    used: used.length,
    ignored,
  };
}

/** The shapes in GeoJSON text, for showing on the map; none when it does not parse. */
export function shapesOfText(text: string): readonly Shape[] {
  if (text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return (isJsonObject(parsed) ? shapesIn(parsed) : undefined) ?? [];
  } catch {
    return [];
  }
}
