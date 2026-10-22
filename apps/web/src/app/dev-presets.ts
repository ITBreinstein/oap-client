/**
 * The reference servers from `infra/`, offered on the start screen in
 * development only. `App` includes them behind `import.meta.env.DEV`, which a
 * production build replaces with `false`, so these addresses never reach the
 * hosted bundle; the hosted page's presets come from `config.json`.
 */

import type { Example, Preset } from "../config/runtime-config.js";

export const DEV_PRESETS: readonly Preset[] = [
  { title: "pygeoapi, with CORS (local)", url: "http://localhost:5080" },
  { title: "pygeoapi, without CORS (local)", url: "http://localhost:5081" },
  { title: "ZOO-Project (local)", url: "http://localhost:5090/ogc-api" },
];

const LOCAL = "http://localhost:5080";

/**
 * Examples on the local pygeoapi with CORS, in development only, behind
 * `import.meta.env.DEV` as the presets are. What each needs is what the page
 * makes of its description.
 */
export const DEV_EXAMPLES: readonly Example[] = [
  {
    service: LOCAL,
    process: "breinstein-buildings",
    title: "Buildings in an area",
    summary: "Draw a shape; get the buildings inside it.",
    needs: "area",
    featured: true,
  },
  {
    service: LOCAL,
    process: "breinstein-aerial",
    title: "Aerial photograph of an area",
    summary: "Draw a shape; get the current aerial photograph of its box.",
    needs: "area",
    featured: true,
  },
  {
    service: LOCAL,
    process: "breinstein-feature-area",
    title: "Area of each feature",
    summary: "Give GeoJSON features; get each one back with its area.",
    needs: "data",
    featured: true,
  },
  {
    service: LOCAL,
    process: "hello-world",
    title: "Hello World",
    summary: "Type a name; the service greets it back.",
    needs: "values",
    featured: true,
  },
  {
    service: LOCAL,
    process: "breinstein-bbox",
    title: "Bounding box to feature",
    summary: "Draw a box; get it back as a GeoJSON feature.",
    needs: "area",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-rotate",
    title: "Rotate a polygon a quarter turn",
    summary: "Draw a polygon; get it turned 90 degrees counter-clockwise.",
    needs: "area",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-inputs",
    title: "Every input kind",
    summary: "One of each kind of input, to see every form control.",
    needs: "area",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-png",
    title: "Generated PNG",
    summary: "Pick a size; get a small square PNG back.",
    needs: "values",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-dates",
    title: "Dates and times",
    summary: "Give a date and an instant; see what the server understood.",
    needs: "values",
    featured: false,
  },
  {
    service: LOCAL,
    process: "slow",
    title: "Slow process",
    summary: "Waits a number of seconds; good for background runs.",
    needs: "values",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-async-only",
    title: "Slow process, background only",
    summary: "Runs only in the background: watch it in My jobs.",
    needs: "values",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-sync-only",
    title: "Slow process, foreground only",
    summary: "Runs only in the foreground: the page waits for it.",
    needs: "values",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-fail-late",
    title: "Process that fails after a while",
    summary: "Runs a while, then fails on purpose: see a failure reported.",
    needs: "values",
    featured: false,
  },
  {
    service: LOCAL,
    process: "breinstein-link",
    title: "A link to a file on another server",
    summary: "No inputs; the result is a link to load.",
    needs: "values",
    featured: false,
  },
];
