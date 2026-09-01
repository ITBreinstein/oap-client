module.exports = {
  forbidden: [
    {
      name: "core-is-framework-free",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "node_modules/(react|react-dom|maplibre-gl|terra-draw)" },
    },
    {
      // ESLint catches a direct `node:fs` import; this catches one reached
      // through a dependency, which is the version nobody spots in review.
      name: "core-is-runtime-neutral",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "core-does-not-know-apps",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^apps" },
    },
    {
      name: "only-map-binding-touches-maplibre",
      severity: "error",
      from: { path: "^apps/web/src", pathNot: "^apps/web/src/map" },
      to: { path: "node_modules/(maplibre-gl|terra-draw)" },
    },
    {
      name: "map-binding-knows-no-protocol",
      severity: "error",
      from: { path: "^apps/web/src/map" },
      to: { path: "^packages/core" },
    },
    {
      // The execution layer sits on the transport, the links, the process
      // types, the errors and the observations — and on nothing else. Discovery
      // and conformance are deliberately out of reach: execution navigates by a
      // URL it was handed, and a dependency on the layer that *finds* that URL
      // would make the operation impossible to test or reuse in isolation.
      name: "execution-sits-on-its-own-layers",
      severity: "error",
      from: { path: "^packages/core/src/execution" },
      to: {
        path: "^packages/core/src",
        pathNot: [
          "^packages/core/src/(execution|http|links|processes)/",
          "^packages/core/src/(errors|observations)\\.ts$",
        ],
      },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    // pnpm makes an undeclared import unresolvable; make that a build failure
    // rather than something you notice after publishing.
    { name: "not-to-unresolvable", severity: "error", from: {}, to: { couldNotResolve: true } },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.base.json" },
    doNotFollow: { path: "node_modules" },
    // Defaults miss .mjs/.cjs and the "exports"/"import" condition, which makes
    // legitimate imports look unresolvable and the rules above go quiet.
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json"],
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    exclude: { path: "(^|/)(dist|\\.tsbuild|coverage)(/|$)" },
  },
};
