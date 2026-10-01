/**
 * How much the map is asked to draw, and to edit, from `config.json`
 * (`map.maxCoordinates`, `map.maxEditableCoordinates`). Read by the map pane,
 * which leaves a result or input over the first limit off the map and never
 * hands an input over the second to the draw mode, by the result list, which
 * says why and points to the download, and by the GeoJSON fields, which turn
 * "Draw on the map" off and say why.
 */

import { createContext, useContext, useMemo } from "react";
import {
  DEFAULT_MAX_EDITABLE_COORDINATES,
  DEFAULT_MAX_MAP_COORDINATES,
} from "../config/runtime-config.js";
import { shapesOfText } from "../forms/geometry.js";
import { positionCount } from "../results/plottable.js";

export interface MapLimits {
  /** The most positions one result, or one input, may have to be drawn. */
  readonly maxCoordinates: number;
  /** The most positions one input may have to be edited on the map. */
  readonly maxEditableCoordinates: number;
}

export const MapLimitsContext = createContext<MapLimits>({
  maxCoordinates: DEFAULT_MAX_MAP_COORDINATES,
  maxEditableCoordinates: DEFAULT_MAX_EDITABLE_COORDINATES,
});

/** An input's GeoJSON is too large to edit on the map: how large, and the limit. */
export interface TooManyToEdit {
  readonly positions: number;
  readonly limit: number;
}

/** Whether this GeoJSON text is too large for the map to edit; undefined when it is not. */
export function tooManyToEdit(text: string, limit: number): TooManyToEdit | undefined {
  const positions = positionCount(shapesOfText(text));
  return positions > limit ? { positions, limit } : undefined;
}

/** {@link tooManyToEdit} for a field's text, against the configured limit; parsed once per text. */
export function useTooManyToEdit(text: string): TooManyToEdit | undefined {
  const { maxEditableCoordinates } = useContext(MapLimitsContext);
  return useMemo(() => tooManyToEdit(text, maxEditableCoordinates), [text, maxEditableCoordinates]);
}

/** What a GeoJSON field says when the map will not edit its value. */
export function tooManyToEditMessage({ positions, limit }: TooManyToEdit): string {
  return `This input has ${positions.toLocaleString("en")} coordinates, more than the ${limit.toLocaleString("en")} the map edits at once, so it cannot be drawn on. It is shown on the map, read-only. Change it here as text, or load another file.`;
}
