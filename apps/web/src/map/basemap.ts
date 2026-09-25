/**
 * The one basemap (T9): PDOK's BRT-Achtergrondkaart, "standaard", in
 * EPSG:3857.
 *
 * Verified 2026-09-23 (Task 7, Z6): tiles load from a page on another origin
 * with no key, answering `Access-Control-Allow-Origin: *`; the WMTS
 * capabilities declare no fees and no access constraints; the template below is
 * the one those capabilities advertise. The data is Kadaster's BRT, published
 * under CC BY 4.0, which is what the attribution credits.
 */

export const PDOK_BRT_TILES =
  "https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png";

/** The capabilities list tile matrices 00–19 for EPSG:3857. */
export const PDOK_BRT_MAX_ZOOM = 19;

export const PDOK_BRT_ATTRIBUTION =
  'Kaartgegevens &copy; <a href="https://www.kadaster.nl">Kadaster</a> (BRT-Achtergrondkaart, CC BY 4.0), via <a href="https://www.pdok.nl">PDOK</a>';

/** The Netherlands, west, south, east, north: where the demo starts. */
export const INITIAL_BOUNDS = [3.2, 50.7, 7.3, 53.6] as const;

/**
 * The drawn input's colours. Amber and dashed-looking by weight, so nothing
 * Task 8 shows as a *result* — which will be the blue end of the palette — can
 * be mistaken for what the user drew.
 */
export const INPUT_STYLE = {
  fill: "#d97706",
  fillOpacity: 0.12,
  outline: "#b45309",
  outlineWidth: 3,
} as const;

/**
 * Terra Draw's select mode, in the same colours: left alone it shows a
 * selected shape, its corners and its midpoints in its own blue.
 */
export const SELECTED_INPUT_STYLES = {
  selectedPointColor: INPUT_STYLE.fill,
  selectedPointOutlineColor: INPUT_STYLE.outline,
  selectedLineStringColor: INPUT_STYLE.outline,
  selectedPolygonColor: INPUT_STYLE.fill,
  selectedPolygonFillOpacity: 0.25,
  selectedPolygonOutlineColor: INPUT_STYLE.outline,
  selectionPointColor: INPUT_STYLE.fill,
  selectionPointOutlineColor: INPUT_STYLE.outline,
  midPointColor: INPUT_STYLE.fill,
  midPointOutlineColor: INPUT_STYLE.outline,
} as const;
