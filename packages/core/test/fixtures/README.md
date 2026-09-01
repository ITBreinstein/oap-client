# Captured fixtures

Payloads captured verbatim from live servers. They are **evidence**: findings
quote them, and the contract and interop tests compare live responses against
them so that an upstream change shows up as a test failure rather than as quiet
drift. `.prettierignore` excludes this whole tree — a fixture that has been
through a pretty-printer can no longer prove what the server sent, and ZOO's
compact, slash-escaped JSON is itself part of the evidence.

A finding that names a fixture has to name a *rebuildable* server, which is why
the versions are recorded here rather than left to a commit message.

## `pygeoapi/`

    server    geopython/pygeoapi:0.21.0   (infra/compose/pygeoapi.yml, port 5080)
    captured  landing-page.json, landing-page-browser-accept.html,
              conformance.json                                        2026-08-26
              process-list.json, processes/hello-world.json           2026-08-31

Re-capture by hand against `http://localhost:5080`; there is no script, because
the set is four files and the server is one pinned image.

    docker compose -f infra/compose/pygeoapi.yml up -d --wait
    curl -sSf -H 'Accept: application/json' -o pygeoapi/process-list.json \
      http://localhost:5080/processes

## `zoo-project/`

    server    ZOO-Project, fork 46289f6 (Gouwe-Gozer), on upstream 19f3c4ee
              — see infra/zoo/pinned.env and infra/zoo/README.md
    port      5090, under /ogc-api
    captured  landing-page.json, conformance.json                     2026-08-28
              process-list-limit20.json,
              processes/{echo,longProcess,Buffer,Centroid,Ogr2Ogr}.json 2026-08-28
              process-list-limit20-skip20.json,
              process-list-limit20-skip690.json,
              processes/Gdal_Translate.json                            2026-08-31

Re-capture with `./infra/zoo/capture-fixtures.sh`, and only when the pinned SHA
in `infra/zoo/pinned.env` changes. Read the diff before committing it.

### Which processes, and why not all of them

The deployment advertises **703**. 657 of those are auto-generated wrappers
inherited from the base image — 551 `SAGA.*` and 106 `OTB.*` — each a mechanical
translation of a third-party tool's command line, and all the same shape as each
other. Committing them would add ~5 MB and teach us nothing the second one did
not.

The set worth having is the **~46 local service providers the fork itself
bundles**: hand-written descriptions, ~100 kB in total, and the only processes
on this server carrying anything the form generator has not already seen.
`capture-fixtures.sh` now takes all of them, deriving the set by excluding the
`SAGA.`/`OTB.`/`GRASS.` namespaces rather than hardcoding a list, so a service
added to the fork is captured on the next run instead of being silently missed.

**Six of those 46 are committed so far** — the ones listed below, captured
by hand while the shapes were being investigated. Running the script against a
live `:5090` fills in the rest; nothing in the test suite depends on them yet.

Two processes are advertised in `/processes` but answer 500 rather than a
description — `OTB.ReadImageInfo` and `OTB.ConvertSensorToGeoPoint`, finding
0020. The script reports and skips them; their absence is the evidence, not a
capture failure.

### The ones worth knowing about

- `echo`, `EchoProcess`, `org.n52.javaps.test.echo`,
  `org.n52.javaps.test.EchoProcess` — the only bounding-box inputs on the
  server: inline `format: "ogc-bbox"` objects, finding 0023.
- `Buffer`, `Centroid` — geometry in and out, via `oneOf` with
  `contentMediaType` and `contentSchema`, plus ZOO's vendor `extended-schema`
  sibling (finding 0022).
- `Ogr2Ogr` — `maxOccurs: 1024`, the numeric multiple case.
- `Gdal_Translate` — the **only** process of 703 with a live
  `maxOccurs: "unbounded"`, on its `GCP` input.
- `longProcess` — for async polling, later.
