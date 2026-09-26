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
      // The generated-forms layer is a promised extension point, and its next
      // home may be the core or a `forms` subpath export. It stays movable only
      // while it depends on nothing but itself and the core: no React, no map,
      // and nothing else in the web app — not the relay, not the workflow, not
      // the screens. Task 7, T1.
      name: "form-plan-is-framework-free",
      severity: "error",
      from: { path: "^apps/web/src/forms/" },
      to: {
        path: "(node_modules/(react|react-dom|maplibre-gl|terra-draw)|^apps/)",
        pathNot: "^apps/web/src/forms/",
      },
    },
    {
      // Deciding what a result is, and following an output given by
      // reference, never draws: features reach the map through the screen's
      // data path, the same one inline GeoJSON takes, and nothing here calls
      // MapLibre or renders. Task 8, T8.
      name: "results-are-framework-free",
      severity: "error",
      from: { path: "^apps/web/src/results/" },
      to: { path: "node_modules/(react|react-dom|maplibre-gl|terra-draw)" },
    },
    {
      // The execution layer sits on the transport, the links, the process
      // types, the errors, the observations and the vocabulary — and on nothing
      // else. Discovery and conformance are deliberately out of reach:
      // execution navigates by a URL it was handed, and a dependency on the
      // layer that *finds* that URL would make the operation impossible to test
      // or reuse in isolation.
      //
      // `jobs/` is out of reach too, and an earlier version of this rule let
      // `jobs/types.ts` through by name so that `classifyExecution()` could
      // borrow the OGC job status vocabulary. That exemption is gone: the thing
      // crossing the boundary was `isJobState`, a *function*, so the edge was
      // real at runtime and not merely a type reference. The vocabulary now
      // lives below both layers in `src/vocabulary/`, which is where something
      // two layers share belongs.
      name: "execution-sits-on-its-own-layers",
      severity: "error",
      from: { path: "^packages/core/src/execution" },
      to: {
        path: "^packages/core/src",
        pathNot: [
          "^packages/core/src/(execution|http|links|processes|vocabulary)/",
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
      // Note what is absent: `execution`. Nothing here imports it today, and
      // nothing should — the shared job status vocabulary lives in
      // `src/vocabulary/` precisely so neither layer has to reach for the
      // other, and allowing both directions is how a cycle gets in.
      name: "jobs-sit-on-their-own-layers",
      severity: "error",
      from: { path: "^packages/core/src/jobs" },
      to: {
        path: "^packages/core/src",
        pathNot: [
          "^packages/core/src/(jobs|http|links|vocabulary)/",
          "^packages/core/src/discovery/negotiate\\.ts$",
          "^packages/core/src/(errors|observations)\\.ts$",
        ],
      },
    },
    {
      // `src/vocabulary/` is what both `execution` and `jobs` are allowed to
      // depend on, so it must depend on nobody. A module everyone may import
      // that imports something itself is a cycle with extra steps, and the
      // no-circular rule below would only catch it once the cycle closed.
      //
      // This is the rule that replaces the file-level exemption Task 5 added.
      // It is strictly stronger: the exemption said "execution may reach one
      // named file in another layer", which decays the moment that file grows
      // an import. This says the shared module may reach nothing at all, which
      // does not decay.
      name: "vocabulary-imports-nothing",
      severity: "error",
      from: { path: "^packages/core/src/vocabulary" },
      to: { path: "^packages/core/src", pathNot: "^packages/core/src/vocabulary/" },
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
