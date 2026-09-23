/**
 * The map (S5): MapLibre over PDOK's BRT-Achtergrondkaart, and bounding-box
 * drawing when a form field asks for it.
 *
 * Knows geometry, not the protocol (`map-binding-knows-no-protocol`): it is
 * handed four numbers and hands four numbers back. When the map cannot start —
 * no WebGL, as in a test runner or an old browser — it says so and the form's
 * typed coordinates remain the way in.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
// MapLibre 6 looks for its worker next to its own module, which a bundle moves.
// Vite bundles the worker as an ES module and hands its URL over instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_BOUNDS,
  PDOK_BRT_ATTRIBUTION,
  PDOK_BRT_MAX_ZOOM,
  PDOK_BRT_TILES,
} from "./basemap.js";
import type { CreateDrawEngine } from "./draw-engine.js";
import { useBoundingBoxDraw, type BboxDrawProps } from "./useBoundingBoxDraw.js";

export type CreateMap = (container: HTMLElement, reducedMotion: boolean) => MapLibreMap;

export const createPdokMap: CreateMap = (container, reducedMotion) => {
  setWorkerUrl(workerUrl);
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      sources: {
        brt: {
          type: "raster",
          tiles: [PDOK_BRT_TILES],
          tileSize: 256,
          maxzoom: PDOK_BRT_MAX_ZOOM,
          attribution: PDOK_BRT_ATTRIBUTION,
        },
      },
      layers: [{ id: "brt", type: "raster", source: "brt" }],
    },
    bounds: [
      [INITIAL_BOUNDS[0], INITIAL_BOUNDS[1]],
      [INITIAL_BOUNDS[2], INITIAL_BOUNDS[3]],
    ],
    attributionControl: false,
    fadeDuration: reducedMotion ? 0 : 300,
  });
  map.addControl(new AttributionControl({ compact: false }));
  map.addControl(new NavigationControl({ showCompass: false }));
  return map;
};

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface MapViewProps {
  /** Bounding-box drawing for one form field; absent when nothing is drawing. */
  readonly draw: BboxDrawProps;
  /** Whether the map started, so the form can offer "Draw on the map" or not. */
  readonly onAvailable?: ((available: boolean) => void) | undefined;
  readonly createMap?: CreateMap | undefined;
  readonly createEngine?: CreateDrawEngine | undefined;
}

export function MapView({
  draw,
  onAvailable,
  createMap = createPdokMap,
  createEngine,
}: MapViewProps) {
  const [map, setMap] = useState<MapLibreMap | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const available = useRef(onAvailable);
  useEffect(() => {
    available.current = onAvailable;
  });

  // A ref callback with a cleanup (React 19): the map is created when its
  // container is attached and removed when it is detached — on unmount, and
  // before a new one is made if `createMap` changes.
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      let created: MapLibreMap;
      try {
        created = createMap(element, prefersReducedMotion());
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : String(cause));
        available.current?.(false);
        return;
      }
      setMap(created);
      available.current?.(true);
      return () => {
        available.current?.(false);
        setMap(undefined);
        created.remove();
      };
    },
    [createMap],
  );

  useBoundingBoxDraw(map, draw, createEngine);

  return (
    <div className="map-view">
      <div
        ref={attach}
        className="map-canvas"
        role="region"
        aria-label={
          draw.active
            ? "Map: drag a rectangle to set the bounding box"
            : "Map of the Netherlands (BRT-Achtergrondkaart)"
        }
        data-drawing={draw.active ? "true" : "false"}
      />
      {failure !== undefined && (
        <p className="map-failure">
          The map could not be started ({failure}). Bounding boxes can still be typed in.
        </p>
      )}
    </div>
  );
}
