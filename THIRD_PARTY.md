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

## 3. Dependencies

Regenerate with:

```bash
pnpm licenses list --json > /tmp/licenses.json
```

and fold the result into the table below before each release.

| Package       | Version | Licence | Used by |
| ------------- | ------- | ------- | ------- |
| _(generated)_ |         |         |         |
