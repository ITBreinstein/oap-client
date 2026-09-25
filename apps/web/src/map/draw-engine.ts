/**
 * Terra Draw, reduced to the four things a bounding-box field needs: draw a
 * rectangle, show one, let it be edited, and say when it changed.
 *
 * Behind an interface so the hook that uses it can be tested with a stub, and
 * so that the Terra Draw API — which has moved between minor versions — is met
 * in one file.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { INPUT_STYLE, SELECTED_INPUT_STYLES } from "./basemap.js";
import { bboxOfRing, ringOfBbox, type Bbox } from "./bbox.js";

export interface DrawEngine {
  /** Draw a new rectangle; any box already shown is replaced when it finishes. */
  drawRectangle(): void;
  /** Show this box, or none. Leaves the mode alone. */
  show(bbox: Bbox | undefined): void;
  /** Called with the box whenever the user finishes drawing or editing one. */
  onChange(listener: (bbox: Bbox) => void): void;
  /** Remove the draw mode: its layers, its listeners, its cursor. */
  stop(): void;
}

export type CreateDrawEngine = (map: MapLibreMap) => DrawEngine;

const RECTANGLE = "rectangle";
const SELECT = "select";

function polygonRing(feature: GeoJSONStoreFeatures | undefined): number[][] | undefined {
  const geometry = feature?.geometry;
  if (geometry?.type !== "Polygon") return undefined;
  return geometry.coordinates[0];
}

export const createTerraDrawEngine: CreateDrawEngine = (map) => {
  const styles = {
    fillColor: INPUT_STYLE.fill,
    fillOpacity: INPUT_STYLE.fillOpacity,
    outlineColor: INPUT_STYLE.outline,
    outlineWidth: INPUT_STYLE.outlineWidth,
  } as const;
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      // Drag a rectangle, or click two corners: both, so neither a mouse user
      // nor a trackpad user has to discover the other.
      new TerraDrawRectangleMode({ styles, drawInteraction: "click-move-or-drag" }),
      new TerraDrawSelectMode({
        styles: SELECTED_INPUT_STYLES,
        flags: {
          [RECTANGLE]: {
            feature: {
              draggable: true,
              coordinates: { draggable: false, resizable: "opposite" },
            },
          },
        },
      }),
    ],
  });
  draw.start();

  const listeners = new Set<(bbox: Bbox) => void>();
  const emit = (id: string | number) => {
    const feature = draw.getSnapshot().find((candidate) => candidate.id === id);
    const ring = polygonRing(feature);
    const bbox = ring === undefined ? undefined : bboxOfRing(ring);
    if (bbox === undefined) return;
    for (const listener of listeners) listener(bbox);
  };

  draw.on("finish", (id) => {
    // One box per field: a newly drawn rectangle replaces the previous one.
    const others = draw
      .getSnapshot()
      .map((feature) => feature.id)
      .filter((other): other is string | number => other !== undefined && other !== id);
    if (others.length > 0) draw.removeFeatures(others);
    emit(id);
    draw.setMode(SELECT);
  });
  draw.on("change", (ids, type) => {
    if (type === "update" && draw.getMode() === SELECT) {
      for (const id of ids) emit(id);
    }
  });

  return {
    drawRectangle() {
      draw.setMode(RECTANGLE);
    },
    show(bbox) {
      draw.clear();
      if (bbox === undefined) return;
      draw.addFeatures([
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ringOfBbox(bbox)] },
          properties: { mode: RECTANGLE },
        },
      ]);
    },
    onChange(listener) {
      listeners.add(listener);
    },
    stop() {
      listeners.clear();
      if (draw.enabled) draw.stop();
    },
  };
};
