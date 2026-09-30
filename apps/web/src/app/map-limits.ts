/**
 * How much the map is asked to draw, from `config.json` (`map.maxCoordinates`).
 * Read by the map pane, which leaves a result or input over the limit off the
 * map, and by the result list, which says why and points to the download.
 */

import { createContext } from "react";
import { DEFAULT_MAX_MAP_COORDINATES } from "../config/runtime-config.js";

export interface MapLimits {
  /** The most positions one result, or one input, may have to be drawn. */
  readonly maxCoordinates: number;
}

export const MapLimitsContext = createContext<MapLimits>({
  maxCoordinates: DEFAULT_MAX_MAP_COORDINATES,
});
