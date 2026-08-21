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

## 2. Dependencies

Regenerate with:

```bash
pnpm licenses list --json > /tmp/licenses.json
```

and fold the result into the table below before each release.

| Package       | Version | Licence | Used by |
| ------------- | ------- | ------- | ------- |
| _(generated)_ |         |         |         |
