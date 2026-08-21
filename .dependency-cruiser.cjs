module.exports = {
  forbidden: [
    {
      name: "core-is-framework-free",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "node_modules/(react|react-dom|maplibre-gl|terra-draw)" },
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
