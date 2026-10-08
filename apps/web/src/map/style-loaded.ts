/**
 * Waiting for a map's style before drawing on it (review W30).
 *
 * Terra Draw adds its sources and layers as it starts, and MapLibre refuses
 * both until the style is in: "Style is not done loading". `MapView` hands the
 * map on as soon as it is made, so a draw mode asked for in the first frame or
 * so threw, the hook caught it, and the toolbar showed tools that did nothing.
 *
 * Not `isStyleLoaded()`: it also waits for every tile requested so far, so it
 * is false while the map pans, and a draw mode started on it would miss the
 * user's first clicks. What MapLibre's own check asks for is the style alone,
 * and `getStyle()` says exactly that: it returns nothing until the style is in.
 * `style.load` fires when it comes in.
 */

import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/** `getStyle()`, which the types call always there. */
function loadedStyle(map: MapLibreMap): StyleSpecification | undefined {
  return map.getStyle();
}

/** Run `start` once `map`'s style is in. Returns a cancel for a start not yet run. */
export function whenStyleLoaded(map: MapLibreMap, start: () => void): () => void {
  if (loadedStyle(map) !== undefined) {
    start();
    return () => undefined;
  }
  const stop = (): void => {
    map.off("style.load", ready);
  };
  function ready(): void {
    stop();
    start();
  }
  map.on("style.load", ready);
  return stop;
}
