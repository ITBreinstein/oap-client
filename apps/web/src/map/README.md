# Map binding

The only place in `apps/web` allowed to import `maplibre-gl` or `terra-draw`
(enforced by `no-restricted-imports` in eslint.config.js and by
`only-map-binding-touches-maplibre` in .dependency-cruiser.cjs).

It must not import `packages/core` either — the binding knows geometry, not the
protocol. See `map-binding-knows-no-protocol`.
