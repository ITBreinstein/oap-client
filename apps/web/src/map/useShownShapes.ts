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
import { boundsOf, moveTo } from "./fit.js";
import type { MapShape } from "./geometry-engine.js";
import {
  createMapLibreShapeLayers,
  type CreateShapeLayers,
  type ShapeLayers,
  type ShownImage,
  type ShownShapes,
} from "./shape-layers.js";

/** How long an input must stay as it is before the map moves to it (#19): typing pauses. */
export const INPUT_SETTLE_MS = 500;

/** Whether every one of the shapes is within what the map shows now. */
function inView(map: MapLibreMap, shapes: readonly MapShape[]): boolean {
  const bounds = boundsOf(shapes);
  if (bounds === undefined) return true;
  try {
    const view = map.getBounds();
    return (
      bounds[0] >= view.getWest() &&
      bounds[2] <= view.getEast() &&
      bounds[1] >= view.getSouth() &&
      bounds[3] <= view.getNorth()
    );
  } catch {
    return true;
  }
}

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
  onResultClick?: (index: number) => void,
): {
  readonly resultShapes: number;
  readonly resultImage: boolean;
  /** A result is on the map and the map has been moved off it (#16). */
  readonly resultAway: boolean;
  /** Move the map back to the result. */
  readonly showResult: () => void;
} {
  const layers = useRef<ShapeLayers | undefined>(undefined);
  const latest = useRef({ sets, image, onResultClick });
  useEffect(() => {
    latest.current = { sets, image, onResultClick };
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
    // Through the ref, so a new handler each render does not rebuild the layers.
    created.onResultClick((index) => {
      latest.current.onResultClick?.(index);
    });
    return () => {
      created.stop();
      if (layers.current === created) layers.current = undefined;
      setReady(false);
    };
  }, [map, createLayers]);

  // An input changed from outside the map: typed, pasted, loaded, or brought
  // back with its form (#19). Once it has settled, and only when it parses
  // into shapes, the map moves to it, unless it is already wholly in view.
  const inputKey = JSON.stringify(sets.filter((set) => set.role === "input"));
  useEffect(() => {
    if (map === undefined) return undefined;
    const timer = setTimeout(() => {
      const current = latest.current;
      if (resultCount(current.sets) > 0 || current.image !== undefined) return;
      const inputs = current.sets
        .filter((set) => set.role === "input")
        .flatMap((set) => set.shapes);
      if (inputs.length === 0 || inView(map, inputs)) return;
      moveTo(map, inputs);
    }, INPUT_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [inputKey, map]);

  const key = JSON.stringify({ sets, image });
  useEffect(() => {
    const current = latest.current;
    layers.current?.show(current.sets);
    layers.current?.showImage(current.image);
    if (map !== undefined && (resultCount(current.sets) > 0 || current.image !== undefined)) {
      moveTo(map, [...current.sets.flatMap((set) => set.shapes), ...outlineOf(current.image)]);
    }
  }, [key, map]);

  // Whether the result is still in view, each time the map stops moving.
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (map === undefined) return undefined;
    const check = () => {
      const current = latest.current;
      const shapes = [
        ...current.sets.filter((set) => set.role === "result").flatMap((set) => set.shapes),
        ...outlineOf(current.image),
      ];
      setAway(shapes.length > 0 && !inView(map, shapes));
    };
    try {
      map.on("moveend", check);
    } catch {
      return undefined;
    }
    return () => {
      try {
        map.off("moveend", check);
      } catch {
        // Gone already.
      }
    };
  }, [map]);

  const hasResult = resultCount(sets) > 0 || image !== undefined;
  return {
    resultShapes: ready ? resultCount(sets) : 0,
    resultImage: ready && image !== undefined,
    resultAway: ready && hasResult && away,
    showResult: () => {
      const current = latest.current;
      if (map === undefined) return;
      moveTo(map, [...current.sets.flatMap((set) => set.shapes), ...outlineOf(current.image)]);
    },
  };
}
