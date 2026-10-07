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
import { createOwnChanges, shapeIds } from "./terra-draw-common.js";

export interface DrawEngine {
  /** Draw a new rectangle; any box already shown is replaced when it finishes. */
  drawRectangle(): void;
  /** Show this box, or none. Leaves the mode alone. */
  show(bbox: Bbox | undefined): void;
  /**
   * Called with the box whenever the user draws, moves or resizes one. Never
   * for the engine's own changes: showing a box, or selecting it.
   */
  onChange(listener: (bbox: Bbox) => void): void;
  /** Remove the draw mode: its layers, its listeners, its cursor. */
  stop(): void;
}

export type CreateDrawEngine = (map: MapLibreMap) => DrawEngine;

const RECTANGLE = "rectangle";
const SELECT = "select";
const BOXES: ReadonlySet<string> = new Set([RECTANGLE]);

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
  const own = createOwnChanges();
  const emit = (id: string | number) => {
    const feature = draw.getSnapshot().find((candidate) => candidate.id === id);
    const ring = polygonRing(feature);
    const bbox = ring === undefined ? undefined : bboxOfRing(ring);
    if (bbox === undefined) return;
    for (const listener of listeners) listener(bbox);
  };

  // `finish` comes after a new box is drawn, and after every move or resize.
  draw.on("finish", (id, context) => {
    if (own.applying()) return;
    try {
      // Only a new box replaces the old one and hands over to editing. After
      // a move or a resize the box stays selected, ready for the next (W31).
      if (context.action === "draw") {
        own.apply(() => {
          // One box per field. Boxes only: a handle goes with its box.
          const others = shapeIds(draw.getSnapshot(), BOXES).filter((other) => other !== id);
          if (others.length > 0) draw.removeFeatures(others);
          draw.setMode(SELECT);
        });
      }
    } finally {
      emit(id);
    }
  });
  draw.on("change", (ids, type) => {
    // Showing a typed box clears the old one, which deselects it first: an
    // `update`, and ours, not the user's (W15).
    if (own.applying()) return;
    if (type === "update" && draw.getMode() === SELECT) {
      for (const id of ids) emit(id);
    }
  });

  return {
    drawRectangle() {
      own.apply(() => {
        draw.setMode(RECTANGLE);
      });
    },
    show(bbox) {
      own.apply(() => {
        draw.clear();
        if (bbox === undefined) return;
        draw.addFeatures([
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [ringOfBbox(bbox)] },
            properties: { mode: RECTANGLE },
          },
        ]);
      });
    },
    onChange(listener) {
      listeners.add(listener);
    },
    stop() {
      listeners.clear();
      if (!draw.enabled) return;
      try {
        draw.stop();
      } catch {
        // MapView's ref cleanup can remove the map, its style with it, before
        // this runs: React 19 runs ref cleanups ahead of effect cleanups. The
        // draw mode's layers went with the style; nothing is left to remove
        // (W29).
      }
    },
  };
};
