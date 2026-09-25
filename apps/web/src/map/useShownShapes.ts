/**
 * Shapes shown on a map, driven by the workflow: a result and its input.
 *
 * The layers exist for as long as the map does. A new set of shapes replaces
 * the old; when it holds a result, the map moves to show all of it, and when
 * it is empty, the map is left where the user put it. Reports how many result
 * shapes are on the map, which is 0 until its style has loaded.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { moveTo } from "./fit.js";
import {
  createMapLibreShapeLayers,
  type CreateShapeLayers,
  type ShapeLayers,
  type ShownShapes,
} from "./shape-layers.js";

function resultCount(sets: readonly ShownShapes[]): number {
  return sets
    .filter((set) => set.role === "result")
    .reduce((total, set) => total + set.shapes.length, 0);
}

export function useShownShapes(
  map: MapLibreMap | undefined,
  sets: readonly ShownShapes[],
  createLayers: CreateShapeLayers = createMapLibreShapeLayers,
): { readonly resultShapes: number } {
  const layers = useRef<ShapeLayers | undefined>(undefined);
  const latest = useRef(sets);
  useEffect(() => {
    latest.current = sets;
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
    created.show(latest.current);
    created.onReady(() => {
      setReady(true);
    });
    return () => {
      created.stop();
      if (layers.current === created) layers.current = undefined;
      setReady(false);
    };
  }, [map, createLayers]);

  const key = JSON.stringify(sets);
  useEffect(() => {
    const current = latest.current;
    layers.current?.show(current);
    if (map !== undefined && resultCount(current) > 0) {
      moveTo(
        map,
        current.flatMap((set) => set.shapes),
      );
    }
  }, [key, map]);

  return { resultShapes: ready ? resultCount(sets) : 0 };
}
