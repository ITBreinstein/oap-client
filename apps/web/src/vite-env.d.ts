/// <reference types="vite/client" />

// The relay's URL is not a build setting: it comes from `config.json` at run
// time (src/config/runtime-config.ts), so one build serves every deployment.

/** The web app's version from its package.json, written in at build time (vite.config.ts). */
declare const __APP_VERSION__: string;
