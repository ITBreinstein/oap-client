# Captured fixtures

Payloads captured verbatim from live servers. They are **evidence**: findings
quote them, and the contract and interop tests compare live responses against
them so that an upstream change shows up as a test failure rather than as quiet
drift. `.prettierignore` excludes this whole tree — a fixture that has been
through a pretty-printer can no longer prove what the server sent, and ZOO's
compact, slash-escaped JSON is itself part of the evidence.

Two file extensions, and the difference matters. A `.json` fixture is a response
**body**. A `.http` fixture is a whole `curl -i` capture — status line, every
response header, then the body. Execution fixtures are `.http` because for this
operation the headers *are* half the evidence: `Location` on a synchronous 200
is finding 0024, `Preference-Applied` is what proves the async preference was
honoured rather than guessed, and a `Content-Type` that disagrees with its own
body is finding 0026. A body-only capture would have lost all three.

`callbacks/*.http` are the exception to "response": each is a **request** the
server sent to a callback listener, reconstructed from the listener's raw
headers — request line, every header in the order received, then the body.
Findings 0047 and 0048. The two `*-unreachable.http` files beside them are
ordinary `curl -i` captures of the job document left behind.

A finding that names a fixture has to name a *rebuildable* server, which is why
the versions are recorded here rather than left to a commit message.

## `pygeoapi/`

    server    geopython/pygeoapi:0.21.0   (infra/compose/pygeoapi.yml, port 5080)
    captured  landing-page.json, landing-page-browser-accept.html,
              conformance.json                                        2026-08-26
              processes/hello-world.json                              2026-08-31
              execution/*.http                                        2026-09-01
              jobs/*.http                                             2026-09-16
              process-list.json  (re-captured; now carries `slow`)    2026-09-16
              callbacks/*.http, jobs/job-list-{first,last}-page.http,
              execution/preflight-execute-{cors,nocors}.http          2026-09-23
              processes/breinstein-{bbox,inputs,png}.json,
              process-list.json  (re-captured; now carries all five)  2026-09-23
              processes/breinstein-inputs.json (re-captured; now
                carries the optional geometry input `area`)          2026-09-25
              processes/breinstein-rotate.json,
              process-list.json  (re-captured; now carries all six)   2026-09-25
              processes/breinstein-aerial.json,
              process-list.json  (re-captured; now carries all seven) 2026-09-25

The `breinstein-*` descriptions are processes this repository adds to the
pinned image (see `infra/README.md`). They are the only descriptions a browser
can fetch live — `:5080` is the one server with CORS — so they are what the web
client's generated form is tested against, in Vitest from these files and in
Playwright live.

Re-capture by hand against `http://localhost:5080`; there is no script, because
the set is a handful of files and the server is one pinned image.

    docker compose -f infra/compose/pygeoapi.yml up -d --wait
    curl -sSf -H 'Accept: application/json' -o pygeoapi/process-list.json \
      http://localhost:5080/processes
    curl -sSf -H 'Accept: application/json' -o pygeoapi/processes/breinstein-bbox.json \
      http://localhost:5080/processes/breinstein-bbox

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
              execution/*.http                                         2026-09-01
              jobs/*.http                                              2026-09-16
              callbacks/*.http, execution/preflight-execute.http       2026-09-23
              processes/ — fifteen more (see "Task 7's additions")    2026-09-23

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

**Six of those 46 were committed first** — the ones listed below, captured
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

### Task 7's additions

Fifteen more, chosen so that every schema shape the form generator meets on
this server has at least one committed example — the census over all 701 is
the evidence, these are the samples it is checked against:

- **Every `oneOf` shape** (Z2): `IsValid` (two branches carrying
  `contentSchema`), `Simplify` (one of those plus a bare object),
  `EchoProcess` (one branch plus a bare object), `SAGA.pointcloud_tools.5` (a
  single branch), `SAGA.table_tools.22` (two), `OTB.PixelValue` (three),
  `SAGA.statistics_points.3` (two plus a bare object),
  `OTB.ComputeOGRLayersFeaturesStatistics` (a bare object between encodings),
  `SAGA.statistics_grid.12` (four — the commonest shape, 629 inputs), and
  `GdalExtractProfile` and `display`, the only two whose branches are nothing
  but bare objects.
- **Validation** (Z5): `SAGA.garden_fractals.1`, the one process that runs here
  with both an `enum` and a numeric range, and `HelloPy`, a required input.
- **Booleans**: `SAGA.db_odbc.9`, a runnable example of the 457 booleans
  declared with a string `enum` (finding 0056); `Gdal_Warp`, optional booleans
  with no default.

## `*/execution/`

Captured 2026-09-01 against both servers, with `curl -isS -X POST` and
`Content-Type: application/json`. What each one holds and why it is kept:

    pygeoapi/execution/
      hello-world-sync.http           200 + Location, body is the result   0024
      hello-world-document.http       response:"document" → outputs array  0027
      hello-world-raw.http            response:"raw" → identical to default 0027
      hello-world-async-201.http      201, Preference-Applied, body `null` 0004
      hello-world-missing-input.http  400 + Location, non-RFC7807 body     0024, 0001
      hello-world-reference.http      transmissionMode ignored silently    0028

    zoo-project/execution/
      echo-inputs-only-400.http       inputs-only body is refused          0025
      echo-sync.http                  the same body plus `outputs` works   0025
      echo-raw.http                   raw single output, mislabelled JSON  0026
      echo-async-201.http             201 + full job document + monitor link
      echo-missing-input-500.http     rejected input reported as 500       0016
      echo-bbox.http                  the ogc-bbox input, executed         0023
      buffer-raw-gml.http             GML under Content-Type: application/json 0026

    Task 7, 2026-09-23:

    pygeoapi/execution/
      breinstein-inputs-unvalidated.http          wrong type, range, enum, length,
                                                  occurrences, undeclared: all 200 0054
      breinstein-inputs-qualified-not-unwrapped.http
                                                  a qualified value reaches the
                                                  processor as an object         0052
      breinstein-bbox-epsg4326-400.http           our process refusing a non-CRS84 box

    zoo-project/execution/
      echo-bbox-crs84-relabelled.http   CRS84 in, EPSG:4326 out, same numbers  0051
      echo-bbox-three-coordinates.http  three numbers accepted as a bbox        0051
      echo-complex-bare-object-500.http a bare object for a complex input → 500 0052
      echo-complex-value-object.http    the same object as { value } works      0052
      echo-href.http                    a by-reference input, fetched
      echo-href-unreachable.http        an unreachable href: 200, value gone    0053
      saga-fractals-above-maximum-accepted.http    MINSIZE 1000 of max 100: 200 0054
      saga-fractals-unknown-enum-accepted.http     TYPE "Circles": 200          0054
      saga-fractals-wrong-type-500.http            ANGLE "abc": HTML 500        0055
      saga-fractals-in-range-500.http              ANGLE 90 of max 90: HTML 500 0055
      hellopy-missing-required-400.http            the one check ZOO makes      0054

`hello-world-*.http` carry a fresh job UUID and timestamp per capture, so they
are read for shape and headers rather than compared byte-for-byte. Re-capture by
replaying the `curl` in the finding that names the file; there is no script,
because each one exists to prove a different claim and a script would invite
re-capturing all of them without reading the diff.

## `*/jobs/`

Captured 2026-09-16 against both servers, with `curl -isS`. The pygeoapi set uses
the `slow` process, which this repository adds to the pinned image precisely so
that a job can be observed *before* it finishes — see `infra/README.md`. The ZOO
set uses `longProcess` and `failR`.

    pygeoapi/jobs/
      slow-async-201.http               201, Preference-Applied, body `null`   0004
      slow-accepted.http                still executing, yet `status:accepted` 0032
      slow-successful.http              terminal, progress 100
      slow-failed.http                  failure is prose in `message`, no
                                        `exception`, and no `links` at all     0034, 0042
      slow-results.http                 the result, for Accept: application/json
      slow-results-accept-any-html.http the *same* result for Accept: */*,
                                        as a rendered HTML page                0036
      slow-results-not-ready-404.http   404 ResultNotReady while unfinished
      slow-results-failed-400.http      400 for a failed job (ZOO answers 200)  0041
      slow-delete-200.http              JSON body under Content-Type text/html  0037
      slow-delete-running-200.http      identical for a *running* job
      slow-after-dismiss-404.http       the job is gone, not parked             0035
      job-list-limit2.http              `jobs`, no numberTotal, `next` with offset=
      preflight-delete-cors.http        OPTIONS on :5080 — DELETE is allowed    0040
      preflight-delete-nocors.http      OPTIONS on :5081 — no CORS headers      0040

    zoo-project/jobs/
      longprocess-async-201.http        201 whose body is a full job document
                                        carrying rel="monitor" — the route a
                                        browser needs and pygeoapi lacks        0039
      longprocess-running.http          a genuinely `running` job, progress 40  0032
      longprocess-successful.http       terminal, with a `results` link
      longprocess-results.http          Transfer-Encoding: chunked, no length
      longprocess-delete-200.http       honest application/json, rel="parent"   0037
      longprocess-after-dismiss-404.http  proper OGC no-such-job exception URI  0035
      failr-failed.http                 failure in `message`, no `exception`    0034
      failr-results-200-exception.http  200 whose body is an exception report   0041
      job-list-limit2.http              `numberTotal`, `next` with skip=        0019
      preflight-delete.http             200 saying "CORS is enabled." with no
                                        CORS headers at all                     0040

Job ids and timestamps are fresh per capture, so these are read for shape and
headers rather than compared byte-for-byte. Re-capture by replaying the `curl`
in the finding that names the file.
