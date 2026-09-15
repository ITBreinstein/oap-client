import type { JsonSchema } from "@breinstein/oap-client";
import type { Feature } from "geojson";
import { boundsOf } from "../map/geojson.js";
import { hasFormat, schemaBranches, schemaEnum } from "../schema/facts.js";

/**
 * Bounding-box inputs.
 *
 * OGC gives a bbox its own wire shape — `{ bbox, crs }` directly under the
 * input id, *not* wrapped in `value` like other complex inputs. Getting that
 * wrong is invisible until a server rejects it, so it lives in its own file
 * with its own tests.
 *
 * This is also the one place the drawing tool's output needs converting: the
 * map's rectangle tool produces an ordinary Polygon, because a box is a
 * constraint on how a shape is drawn rather than a distinct geometry. Turning
 * that polygon into four numbers is this module's job.
 */

/** The wire form: `[west, south, east, north]`, with an optional CRS. */
export interface OgcBbox {
  readonly bbox: readonly number[];
  readonly crs?: string;
}

const OGC_BBOX_FORMAT = "ogc-bbox";

/** Whether the input is a bounding box, per `format: "ogc-bbox"` on any branch. */
export function isBboxInput(schema: JsonSchema): boolean {
  return hasFormat(schema, OGC_BBOX_FORMAT);
}

function crsSchema(schema: JsonSchema): JsonSchema | undefined {
  for (const branch of schemaBranches(schema)) {
    const properties = branch["properties"];
    if (typeof properties !== "object" || properties === null) continue;
    const crs = (properties as Record<string, unknown>)["crs"];
    if (typeof crs === "object" && crs !== null) return crs as JsonSchema;
  }
  return undefined;
}

/**
 * The CRS to send, from what the input advertises.
 *
 * Prefers the declared `default`, but only when the enum admits it: one
 * captured description defaults to CRS84 while its `enum` lists `epsg:4326`
 * alone, and the request that server accepted used the enum's value. A default
 * outside its own enum is the server contradicting itself, and the enum is the
 * half it will actually check.
 */
export function bboxCrsFor(schema: JsonSchema): string | undefined {
  const crs = crsSchema(schema);
  if (crs === undefined) return undefined;

  const fallback = crs["default"];
  const allowed = schemaEnum(crs);

  if (typeof fallback === "string" && (allowed === undefined || allowed.includes(fallback))) {
    return fallback;
  }
  return allowed?.find((value): value is string => typeof value === "string");
}

function numbers(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const found = value.filter((entry): entry is number => typeof entry === "number");
  return found.length === value.length ? found : undefined;
}

/** GeoJSON in any of the shapes the drawing tool or a pasted document produces. */
function featuresOf(value: Record<string, unknown>): readonly Feature[] | undefined {
  if (value["type"] === "FeatureCollection" && Array.isArray(value["features"])) {
    return value["features"] as readonly Feature[];
  }
  if (value["type"] === "Feature") return [value as unknown as Feature];
  if (typeof value["type"] === "string" && value["coordinates"] !== undefined) {
    return [{ type: "Feature", geometry: value as never, properties: {} }];
  }
  return undefined;
}

/**
 * A bbox from whatever the form is holding.
 *
 * Accepts, in order: something already in bbox shape; GeoJSON, whose extent
 * becomes the box; or a bare array of four or six numbers. `undefined` when it
 * is none of those — the caller then leaves the value alone and says so, rather
 * than inventing coordinates.
 */
export function toOgcBbox(value: unknown, schema: JsonSchema): OgcBbox | undefined {
  const crs = bboxCrsFor(schema);
  const withCrs = (bbox: readonly number[]): OgcBbox => ({
    bbox,
    ...(crs === undefined ? {} : { crs }),
  });

  const bare = numbers(value);
  if (bare !== undefined && (bare.length === 4 || bare.length === 6)) return withCrs(bare);

  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;

  const declared = numbers(record["bbox"]);
  if (declared !== undefined && (declared.length === 4 || declared.length === 6)) {
    // Already a bbox. Keep the author's CRS when they gave one.
    const authored = record["crs"];
    return typeof authored === "string" ? { bbox: declared, crs: authored } : withCrs(declared);
  }

  const features = featuresOf(record);
  if (features === undefined) return undefined;

  const bounds = boundsOf(features);
  return bounds === undefined ? undefined : withCrs([...bounds]);
}
