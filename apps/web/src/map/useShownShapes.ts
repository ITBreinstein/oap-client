/**
 * Shapes shown on a map, driven by the workflow: a result and its input, and
 * an image result over the area it covers.
 *
 * The layers exist for as long as the map does. A new set of shapes replaces
 * the old; when it holds a result, the map moves to show all of it, image
 * included, and when it is empty, the map is left where the user put it.
 * Reports how many result shapes are on the map, and whether an image is,
 * which are 0 and false until its style has loaded.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { moveTo } from "./fit.js";
import type { MapShape } from "./geometry-engine.js";
import {
  createMapLibreShapeLayers,
  type CreateShapeLayers,
  type ShapeLayers,
  type ShownImage,
  type ShownShapes,
} from "./shape-layers.js";

function resultCount(sets: readonly ShownShapes[]): number {
  return sets
    .filter((set) => set.role === "result")
    .reduce((total, set) => total + set.shapes.length, 0);
}

/** The image's extent as a shape, so the map can move to it with the rest. */
function outlineOf(image: ShownImage | undefined): MapShape[] {
  if (image === undefined) return [];
  const [west, south, east, north] = image.bounds;
  return [
    {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  ];
}

export function useShownShapes(
  map: MapLibreMap | undefined,
  sets: readonly ShownShapes[],
  image: ShownImage | undefined,
  createLayers: CreateShapeLayers = createMapLibreShapeLayers,
): { readonly resultShapes: number; readonly resultImage: boolean } {
  const layers = useRef<ShapeLayers | undefined>(undefined);
  const latest = useRef({ sets, image });
  useEffect(() => {
    latest.current = { sets, image };
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (map === undefined) return;
    let created: ShapeLayers;
    try {
      created = createLayers(map);
    } catch {
      // A map that cannot take layers still has the results listed beside it.
      return;
    }
    layers.current = created;
    created.show(latest.current.sets);
    created.showImage(latest.current.image);
    created.onReady(() => {
      setReady(true);
    });
    return () => {
      created.stop();
      if (layers.current === created) layers.current = undefined;
      setReady(false);
    };
  }, [map, createLayers]);

  const key = JSON.stringify({ sets, image });
  useEffect(() => {
    const current = latest.current;
    layers.current?.show(current.sets);
    layers.current?.showImage(current.image);
    if (map !== undefined && (resultCount(current.sets) > 0 || current.image !== undefined)) {
      moveTo(map, [...current.sets.flatMap((set) => set.shapes), ...outlineOf(current.image)]);
    }
  }, [key, map]);

  return {
    resultShapes: ready ? resultCount(sets) : 0,
    resultImage: ready && image !== undefined,
  };
}
