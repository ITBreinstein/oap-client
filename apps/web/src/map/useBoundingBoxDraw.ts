/**
 * Bounding-box drawing on a map, driven by a form field (T9).
 *
 * While `active`, the map is in draw mode: the user drags a rectangle, which
 * can then be moved or resized, and every finished change is reported through
 * `onChange` as `[minX, minY, maxX, maxY]` in CRS84 — longitude first. A value
 * set from outside (typed coordinates, or Clear) is shown on the map. When
 * `active` turns false, the map changes, or the component unmounts, the draw
 * mode is removed completely: layers, listeners and cursor.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { roundBbox, sameBbox, type Bbox } from "./bbox.js";
import { createTerraDrawEngine, type CreateDrawEngine, type DrawEngine } from "./draw-engine.js";

export interface BboxDrawProps {
  readonly active: boolean;
  /** CRS84: west, south, east, north. */
  readonly value?: Bbox | undefined;
  readonly onChange: (bbox: Bbox | undefined) => void;
}

export function useBoundingBoxDraw(
  map: MapLibreMap | undefined,
  props: BboxDrawProps,
  createEngine: CreateDrawEngine = createTerraDrawEngine,
): void {
  const { active, value, onChange } = props;
  const engine = useRef<DrawEngine | undefined>(undefined);
  /** What the map shows now, so a value the map itself produced is not redrawn. */
  const shown = useRef<Bbox | undefined>(undefined);
  // The latest handler and value, read by the engine's callbacks without
  // restarting the draw mode on every render.
  const latest = useRef({ onChange, value });
  useEffect(() => {
    latest.current = { onChange, value };
  });

  useEffect(() => {
    if (map === undefined || !active) return;
    let created: DrawEngine;
    try {
      created = createEngine(map);
    } catch {
      // A map that cannot host the draw mode leaves the typed fields working.
      return;
    }
    engine.current = created;
    created.onChange((bbox) => {
      const rounded = roundBbox(bbox);
      shown.current = rounded;
      if (!sameBbox(rounded, latest.current.value)) latest.current.onChange(rounded);
    });
    shown.current = latest.current.value;
    created.show(latest.current.value);
    created.drawRectangle();
    return () => {
      created.stop();
      if (engine.current === created) engine.current = undefined;
    };
  }, [map, active, createEngine]);

  // A value from outside the map: typed, or cleared.
  const key = value === undefined ? "" : value.join(",");
  useEffect(() => {
    const current = engine.current;
    const next = latest.current.value;
    if (current === undefined || sameBbox(next, shown.current)) return;
    shown.current = next;
    current.show(next);
    // Cleared: ready to draw again straight away.
    if (next === undefined) current.drawRectangle();
  }, [key]);
}
