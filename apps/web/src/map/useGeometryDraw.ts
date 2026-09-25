/**
 * GeoJSON drawing on a map, driven by a form field.
 *
 * While `active`, the map is in draw mode with the offered tools; every
 * finished draw, edit or delete is reported through `onChange` with all the
 * shapes drawn. A value set from outside — a loaded file, typed GeoJSON,
 * Clear — is shown, and the map moves to it. When `active` turns false, the
 * tools change, the map changes, or the component unmounts, the draw mode is
 * removed completely.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { moveTo } from "./fit.js";
import {
  createTerraDrawGeometryEngine,
  type CreateGeometryEngine,
  type GeometryDrawState,
  type GeometryEngine,
  type MapShape,
  type Tool,
} from "./geometry-engine.js";

export interface GeometryDrawProps {
  readonly active: boolean;
  readonly tools: readonly Tool[];
  readonly several: boolean;
  readonly value: readonly MapShape[];
  readonly onChange: (shapes: readonly MapShape[]) => void;
}

export interface GeometryDrawControls extends GeometryDrawState {
  place(tool: Tool): void;
  deleteSelected(): void;
}

const IDLE: GeometryDrawState = { placing: undefined, hasSelection: false };

function keyOf(shapes: readonly MapShape[]): string {
  return JSON.stringify(shapes);
}

export function useGeometryDraw(
  map: MapLibreMap | undefined,
  props: GeometryDrawProps,
  createEngine: CreateGeometryEngine = createTerraDrawGeometryEngine,
): GeometryDrawControls {
  const { active, tools, several, value, onChange } = props;
  const engine = useRef<GeometryEngine | undefined>(undefined);
  /** What the map shows now, so a value the map itself produced is not redrawn. */
  const shown = useRef("");
  const latest = useRef({ onChange, value });
  useEffect(() => {
    latest.current = { onChange, value };
  });
  const [state, setState] = useState<GeometryDrawState>(IDLE);

  const toolsKey = tools.join(",");
  useEffect(() => {
    if (map === undefined || !active || toolsKey === "") return;
    let created: GeometryEngine;
    try {
      created = createEngine(map, { tools: toolsKey.split(",") as Tool[], several });
    } catch {
      // A map that cannot host the draw mode leaves typed GeoJSON working.
      return;
    }
    engine.current = created;
    created.onState(setState);
    created.onChange((shapes) => {
      shown.current = keyOf(shapes);
      latest.current.onChange(shapes);
    });
    const initial = latest.current.value;
    shown.current = keyOf(initial);
    created.show(initial);
    moveTo(map, initial);
    return () => {
      created.stop();
      if (engine.current === created) engine.current = undefined;
      setState(IDLE);
    };
  }, [map, active, toolsKey, several, createEngine]);

  // A value from outside the map: loaded, typed, or cleared.
  const key = keyOf(value);
  useEffect(() => {
    const current = engine.current;
    if (current === undefined || key === shown.current) return;
    shown.current = key;
    const next = latest.current.value;
    current.show(next);
    if (map !== undefined) moveTo(map, next);
  }, [key, map]);

  return {
    ...state,
    place: (tool) => engine.current?.place(tool),
    deleteSelected: () => engine.current?.deleteSelected(),
  };
}
