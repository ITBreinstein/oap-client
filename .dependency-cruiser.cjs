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
      //
      // `jobs/types.ts` is reachable, and **only** that file — not the rest of
      // the jobs layer. It owns the OGC job status vocabulary, which execution
      // needs to tell a job document from a result and jobs needs to decide
      // whether a job is terminal. Two copies of one list eventually disagree,
      // so there is one, and it lives with the layer the vocabulary is named
      // after. Allowing the single types module keeps the invariant the rule
      // exists for: execution still cannot reach an *operation* in another
      // layer, only a type — exactly as it already reaches `processes/types`.
      name: "execution-sits-on-its-own-layers",
      severity: "error",
      from: { path: "^packages/core/src/execution" },
      to: {
        path: "^packages/core/src",
        pathNot: [
          "^packages/core/src/(execution|http|links|processes)/",
          "^packages/core/src/jobs/types\\.ts$",
          "^packages/core/src/(errors|observations)\\.ts$",
        ],
      },
    },
    {
      // The jobs layer, under the same discipline and for the same reason: it
      // is handed a job URL and must never depend on the layer that finds one.
      // `discovery/negotiate` is the one exception, and it is the same
      // exception `processes` already takes — `fetchJson` is the shared
      // `?f=json` negotiation policy, not a discovery operation, and a second
      // copy of it in this layer is how the two fall out of step.
      //
      // Note what is absent: `execution`. The dependency runs the other way,
      // and allowing both directions is how a cycle gets in.
      name: "jobs-sit-on-their-own-layers",
      severity: "error",
      from: { path: "^packages/core/src/jobs" },
      to: {
        path: "^packages/core/src",
        pathNot: [
          "^packages/core/src/(jobs|http|links)/",
          "^packages/core/src/discovery/negotiate\\.ts$",
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
