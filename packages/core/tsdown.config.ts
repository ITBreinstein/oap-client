import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  // ESM only, and platform-neutral: no Node built-in resolution, no CJS
  // interop shims, and plain .js/.d.ts filenames rather than .mjs/.cjs.
  format: ["esm"],
  platform: "neutral",
  fixedExtension: false,
  dts: true,
  clean: true,
});
