# Third-party code and dependencies

Two sections, kept separately because they answer different tender questions.

## 1. Adapted source

Every file in this repository that was derived from another project, however
lightly. One row per file. Record the upstream commit SHA — "latest" is not a
provenance record.

| Our file     | Upstream project | Repo | Commit SHA | Upstream file | Licence | What we changed |
| ------------ | ---------------- | ---- | ---------- | ------------- | ------- | --------------- |
| _(none yet)_ |                  |      |            |               |         |                 |

Candidate upstreams for this work: `ogcapi-js`, `ogc-client`, GeoLibre.

## 2. Captured server payloads

Fixtures under `packages/core/test/fixtures/` are responses captured verbatim
from a running server, not adapted source. They are committed so that a change
in upstream behaviour surfaces as a failing test rather than as a silent
behaviour change, and they are excluded from Prettier so they stay byte-exact.

Reproduce a capture by starting the server below and re-running the `curl`
commands in the matching contract test.

| Fixture directory | Server          | Image / digest              | Licence | Captured   |
| ----------------- | --------------- | --------------------------- | ------- | ---------- |
| `pygeoapi/`       | pygeoapi 0.21.0 | `geopython/pygeoapi:0.21.0` | MIT     | 2026-08-26 |

## 3. Runtime services

Services the interface calls at runtime that are neither bundled code nor a
captured payload. They carry obligations that outlive a build.

| Service                    | Endpoint                                         | Licence / terms                                    | Used by                       |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------- | ----------------------------- |
| OpenStreetMap raster tiles | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map data ODbL 1.0; attribution required on the map | `apps/web/src/map/basemap.ts` |

The attribution is rendered by MapLibre's own attribution control, fed by the
`attribution` field on the source in `basemap.ts`. Removing that field removes
the credit and breaks the licence, so it is not cosmetic.

One thing to settle before anything is deployed publicly: the OSM Foundation's
[Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) covers
these tiles, and it does not permit an application to lean on them as its
basemap at any volume. Fine for development and a demo; a deployment needs its
own tiles or a commercial provider.

## 4. Dependencies

Regenerate with:

```bash
pnpm licenses list --json > /tmp/licenses.json
```

and fold the result into the table below before each release.

| Package       | Version | Licence | Used by |
| ------------- | ------- | ------- | ------- |
| _(generated)_ |         |         |         |
