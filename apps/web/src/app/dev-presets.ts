/**
 * The reference servers from `infra/`, offered on the start screen in
 * development only. `App` includes them behind `import.meta.env.DEV`, which a
 * production build replaces with `false`, so these addresses never reach the
 * hosted bundle; the hosted page's presets come from `config.json`.
 */

import type { Preset } from "../config/runtime-config.js";

export const DEV_PRESETS: readonly Preset[] = [
  { title: "pygeoapi, with CORS (local)", url: "http://localhost:5080" },
  { title: "pygeoapi, without CORS (local)", url: "http://localhost:5081" },
  { title: "ZOO-Project (local)", url: "http://localhost:5090/ogc-api" },
];
