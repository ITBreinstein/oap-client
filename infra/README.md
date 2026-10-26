# Reference servers

Two implementations, because one cannot tell a server's deviation apart from an
ambiguous specification.

| Where                  | What                                                    | Lane                                 |
| ---------------------- | ------------------------------------------------------- | ------------------------------------ |
| `compose/pygeoapi.yml` | pygeoapi 0.21.0 on `:5080` (CORS) and `:5081` (no CORS) | `pnpm test:contract`, blocks CI      |
| `zoo/`                 | ZOO-Project fork on `:5090`                             | `pnpm test:interop`, never blocks    |
| `compose/weaver.yml`   | Weaver on `:5100`, the OGC API - Processes 2.0 draft    | `pnpm test:e2e:weaver`, never blocks |

```bash
docker compose -f infra/compose/pygeoapi.yml up -d --wait
./infra/zoo/zoo.sh up
docker compose -f infra/compose/weaver.yml -p oap-weaver up -d --wait
```

Weaver is the one server found, 2026-10-23, that declares the 2.0 draft's Core
class; ZOO-Project and pygeoapi declare 1.0 only. Its config is
[weaver/weaver.ini](weaver/weaver.ini), and the compose file says why it is
shaped as it is. Two things about this image limit what can be run on it: of
its builtin processes only `EchoProcess` runs (the others look for a Python
interpreter the image does not have), and it refuses, with a 422, the arrays of
arrays a form generated from `EchoProcess`'s description sends. See
`e2e/weaver.spec.ts`.

Stop Weaver before running the blocking lane on a laptop
(`docker compose -f infra/compose/weaver.yml -p oap-weaver stop`). Its API and
worker hold about 2 GB and run under emulation on Apple Silicon. Beside them,
pygeoapi answered slowly enough on 2026-10-23 that five of the lane's 5-second
waits ran out, and all 200 passed once Weaver was stopped. CI runs the two
lanes in separate jobs. Keep Weaver stopped unless its lane is running.

Give Docker at least 6 GB of memory when running Weaver. With less, Docker
Desktop stopped every container at once on 2026-10-23 (all exited 137) while
Weaver ran beside pygeoapi and ZOO.

ZOO keeps its job results in a Docker volume, `zoo-data` (`compose/zoo.yml`),
not in the pinned checkout, so they do not survive `./infra/zoo/zoo.sh down`,
which removes the volume. Evidence a finding relies on must be copied into the
findings repository when the finding is written.

ZOO has its own README — [zoo/README.md](zoo/README.md) — covering the fork, the
pinning and why it is not in the contract lane. The rest of this file is about
pygeoapi.

pygeoapi is pinned by digest in `compose/pygeoapi.yml`, as `tag@sha256:…`: the
tag is for reading, the digest is what Docker pulls. To move the pin, run
`docker buildx imagetools inspect geopython/pygeoapi:<tag>` and put the
`Digest:` it prints after the new tag, in both services.

## The two pygeoapi ports

Identical configuration but for one flag. `:5080` sets `cors: true` and
exercises the direct-fetch path; `:5081` sets `cors: false`. Both are needed: a
client that only ever met a CORS-enabled server would ship with a whole class of
browser failure untested.

The relay does not rescue `:5081`. It carries the asynchronous execute and
nothing else, so on `:5081` it can name a job the browser still cannot read
(finding 0049). On `:5080` it is what makes asynchronous execution work from a
browser at all — see [relay/](relay/) and finding 0039.

What the split has actually shown, measured rather than assumed:

- On `:5080` a browser **can** `DELETE /jobs/{id}` — the `OPTIONS` preflight
  answers with `Access-Control-Allow-Methods` including `DELETE`.
- On `:5081` it cannot, because the preflight answers 200 with no CORS headers
  at all and the browser therefore never sends the `DELETE`.
- On **both**, `Location` is invisible to a browser: neither port sends
  `Access-Control-Expose-Headers`, so an asynchronous execute starts a job the
  page cannot name. Findings 0002 and 0009.
- Through the relay, on `:5080`, the browser names the job, watches it
  complete, and hears its callbacks. On `:5081` it names the job and cannot read
  it.

`e2e/jobs-cors.spec.ts` asserts the first three in a real browser, and
`e2e/relay-async.spec.ts` the last.

## Callbacks reach the host

Both ports map `host.docker.internal` to the host gateway, so pygeoapi can call
a relay — or `callbacks/listener.mjs` — running on the host. Docker Desktop
provides the name anyway; Linux, and so CI, needs the mapping. Probes for what
the servers send, and what they do when the receiver misbehaves, are in
[callbacks/](callbacks/).

## Our own processes

`pygeoapi/plugins/` holds processors this repository adds to the pinned image.
They are mounted read-only and put on `PYTHONPATH` by `compose/pygeoapi.yml`, so
they load as ordinary pygeoapi plugins with **no image rebuild** — the image
stays the pinned upstream one, and a finding that names it still names something
anyone can pull.

Registered in both `pygeoapi/config-cors.yml` and `pygeoapi/config-nocors.yml`,
because a process that exists on only one port makes the two lanes incomparable.

### `slow`

```yaml
slow:
  type: process
  processor:
    name: breinstein_slow.SlowProcessor
```

Sleeps for `seconds` (default 5, capped at 600) and returns a small JSON output,
optionally echoing a `message`.

**Why it exists.** The stock image registers one process, `hello-world`, which
completes instantly. Against it every job is `successful` before the first poll
returns, which makes the entire asynchronous surface untestable:

- a non-terminal job is never observed,
- `Retry-After` handling is never exercised,
- cancellation mid-poll cannot be tested,
- `DELETE` on a _running_ job cannot be told apart from `DELETE` on a finished
  one,
- progress reporting has no data.

ZOO's `longProcess` gives a second opinion, but the interop lane never blocks a
release, so it cannot be the deterministic lane. `slow` is what makes
`test/contract/jobs.test.ts` possible.

It is deliberately **not** specific to any use case: it sleeps and echoes, so
nothing in the client can ever be tuned to what it computes.

**What it still cannot show.** pygeoapi reports `status: "accepted"` for the
whole of a job's execution and jumps straight to `successful` — it never reports
`running`, and `progress` is a hardcoded 5 then 100 (finding 0032). `slow` makes
the job last long enough to _observe_, but the vocabulary and the progress
numbers are pygeoapi's. A genuinely `running` job with moving progress only
exists on ZOO, and the interop lane is where that is asserted.

### `breinstein-bbox`, `breinstein-inputs`, `breinstein-png`, `breinstein-rotate`, `breinstein-aerial`

```yaml
breinstein-bbox:
  type: process
  processor:
    name: breinstein_bbox.BboxProcessor
```

…and the same for `breinstein_inputs.InputsProcessor`,
`breinstein_png.PngProcessor`, `breinstein_rotate.RotateProcessor` and
`breinstein_aerial.AerialProcessor`. The
coverage-gap processes that were left on the backlog after `slow`, one hole
each. `:5080` is the only server a browser
can reach (findings 0049, 0050), so without them the web client's generated form
had nothing to be tested against but two string inputs.

| Process             | Closes                               | Inputs → outputs                                                                                                                                                                                                                |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breinstein-bbox`   | a bounding-box input                 | one `format: "ogc-bbox"` object (`properties.bbox`, four numbers, and `properties.crs`, CRS84 only) → the box as a GeoJSON `Feature` polygon, `application/geo+json`                                                            |
| `breinstein-inputs` | every form control, multiple outputs | a bounded string, a multi-line string, a bounded integer, a number with a default, an enum, a boolean, a string repeatable three times, one optional string, one optional GeoJSON geometry → `echo` (JSON) and `summary` (text) |
| `breinstein-png`    | a non-JSON output                    | one bounded integer → an `image/png` of that size                                                                                                                                                                               |
| `breinstein-rotate` | a geometry in and a geometry out     | one GeoJSON `Polygon` (`format: "geojson-polygon"`) → the same polygon turned 90° counter-clockwise about the centre of its bounding box, as seen on a map, `application/geo+json`                                              |
| `breinstein-aerial` | an image of a place                  | one GeoJSON `Polygon` in the Netherlands, at most 25 km across → `image`, the current aerial photograph of its bounding box (JPEG, base64 in a qualified value), and `bbox`, that box in CRS84, as one results map              |

Same rule as `slow`: each one **echoes or reshapes its inputs and computes
nothing**. Four details are deliberate:

- **`breinstein-bbox` refuses any CRS but CRS84** rather than reprojecting.
  Reprojection would be the process doing geography, and whether a client
  swaps axes is the client's decision to be tested, not the server's to hide.
- **`breinstein-inputs` does no validation of its own.** Whether a wrong-typed
  or out-of-range value is refused is then pygeoapi's decision alone, which is
  the thing worth measuring. It echoes the inputs as received, so a browser test
  asserts on what arrived rather than on what the client believes it sent.
  Its multi-line input is `type: "string"` with `contentMediaType: "text/plain"`:
  JSON Schema has no multi-line keyword, and this is the nearest standard one.
- **`breinstein-rotate` turns the polygon as it looks on a map.** Longitude is
  scaled by the cosine of the centre's latitude before the turn and back after
  it; turned in raw degrees, a shape in the Netherlands comes back stretched to
  more than twice its height. That is a local approximation, not a geodesic
  rotation, and it is the one piece of arithmetic in these processes. The turn
  is only there so the output is plainly not the input, and it stays exact
  where a test needs it: four turns give the input back. It takes the polygon
  from a qualified value's `value`, because pygeoapi hands the process the
  wrapper (finding 0052), and it refuses a Feature rather than unwrapping it.
- **Two outputs travel as one JSON results map** (`{ "echo": …, "summary": … }`)
  because a pygeoapi processor returns one media type and one payload. Ask for
  `summary` alone and it comes back raw as `text/plain`.

`breinstein-png` builds its PNG with `zlib` and `struct` only, so the pinned
image needs no extra package.

`breinstein-aerial` is the one that reaches the network. It asks PDOK's `luchtfotorgb` WMS
(layer `Actueel_orthoHR`, Beeldmateriaal Nederland's current aerial photograph,
open data, no key) for the polygon's bounding box in EPSG:3857, so the four
corners it returns in CRS84 place the picture on a web map without resampling.
It refuses an area outside the layer's coverage or wider than 25 km rather than
answering with a blank or useless picture. Because it needs the network, the
contract lane never runs it, and its browser test skips when PDOK is not
answering. The standard cannot say that `bbox` is the extent of `image`; the
output descriptions say so in words, and the web client's pairing of the two
is its own reading (`apps/web/src/results/plottable.ts`).

### The coverage processes

Six more, added together (2026-09-25), each for something the client handles
but no process on the pinned server had exercised. Same rule as above: they
echo, reshape, fail or fetch, and compute as little as they can.

| Process                                         | Closes                                                              | Inputs → outputs                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `breinstein-async-only`, `breinstein-sync-only` | one execution mode                                                  | `slow`, declaring `["async-execute"]` or `["sync-execute"]` only                                                                     |
| `breinstein-fail-late`                          | a job seen running, then failed                                     | `seconds`, `message` → always fails, after `seconds`, with `message`                                                                 |
| `breinstein-dates`                              | `format: "date"` and `"date-time"` inputs                           | a date and an optional RFC 3339 instant → what was understood: weekday, ISO week, the instant in UTC                                 |
| `breinstein-feature-area`                       | an input by reference; a FeatureCollection in and out; a CSV output | a FeatureCollection, inline or as a URL → the features with `area_m2` (geodesic, `pyproj`) as GeoJSON, and a CSV table               |
| `breinstein-buildings`                          | a large GeoJSON result; an output by reference                      | a polygon of at most 1 km → the buildings in it from PDOK's BAG OGC API Features, or a link to the query when asked for by reference |

What they turned up, measured against 0.21.0:

- **pygeoapi describes every process with the server's execution modes**, not
  the process's: both single-mode processes are described as
  `["sync-execute", "async-execute"]`, and every process as
  `outputTransmission: ["value"]` (finding 0059). The execution does read the
  process's own modes for an asynchronous request. So the browser test puts back
  what each process declares before the page sees the description; no pygeoapi
  process can advertise one mode.
- **pygeoapi passes an input reference to the process unresolved**, as
  `{"href": …}` (finding 0058). `breinstein-feature-area` fetches it itself —
  http or https, 30 seconds, 10 MB — and says in its output where the features
  came from.
- **The process list stops at ten.** With thirteen processes, the eleventh on
  was not listed: `limits.max_items` defaults to 10, there is no `next` link,
  and `offset` is ignored (finding 0018, corrected). Both configurations now set
  `limits` to 50.
- A failed job's message is prefixed `InvalidParameterValue: Error executing
process:` whatever the failure was.

`breinstein-aerial`, `breinstein-feature-area` given a URL, and
`breinstein-buildings` reach the network; the contract lane never runs them,
and their browser tests skip when PDOK is not answering.

### `breinstein-link`

One output, always given by reference, to a static file on the _other_
instance (2026-09-26, Task 8). It is the blocking lane's source of a reference
a web page cannot read: `:5080` grants every preflight (finding 0057), PDOK
sends CORS headers, and ZOO, whose references no page can read, is not in the
blocking lane. The two instances differ in exactly that respect, and each
serves its own `/static/`, so:

| Instance | Links to                                    | From a page on another origin |
| -------- | ------------------------------------------- | ----------------------------- |
| `:5080`  | `http://localhost:5081/static/img/logo.png` | blocked: no CORS headers      |
| `:5081`  | `http://localhost:5080/static/img/logo.png` | readable, `image/png`         |

The target and its media type are `target` and `type` under `processor` in
each config; the process takes no inputs and fetches nothing. It declares
`outputTransmission: ["reference"]`, and pygeoapi describes it as `["value"]`
(finding 0059).

### `breinstein-formats`

One output, `features`, offered in three formats, answered in the one asked
for (2026-10-23, #F3): an area, given as a bounding box (a small box in
Utrecht when left out), as one polygon feature in GeoJSON, GML 3.2 or KML.
Asked for none, it answers GeoJSON. A second output, `count`, is always 1, so
that the answer for both outputs — a JSON object keyed by output id, with a
GML or KML `features` as a qualified value carrying its media type — is tested
as well as the answer for one.

| Asked for `features` alone as          | Answer                                       |
| -------------------------------------- | -------------------------------------------- |
| nothing, or `application/geo+json`     | `application/geo+json`, a FeatureCollection  |
| `application/gml+xml; version=3.2`     | that media type, a WFS 2.0 FeatureCollection |
| `application/vnd.google-earth.kml+xml` | that media type, a KML document              |

pygeoapi 0.21.0 lets a process see the `outputs` it was asked for
(`supports_outputs`), which is what makes this possible. It does not let a
process set a response header, so no pygeoapi process can send
`Content-Crs`: there is no `breinstein-rd-geojson`. `breinstein-rd-link`
below is what takes its place.

### `breinstein-gml`

GML 2 shaped as ZOO-Project's OGR services return it (2026-10-26, #F4): an
`ogr:FeatureCollection` of `gml:featureMember`s, `gml:coordinates` with commas,
labelled `text/xml`. One polygon, the area given (a small box in Utrecht when
left out), and its centre as a point, each with two simple properties. The
`crs` input picks the `srsName`, as ZOO's answers have them:

| `crs`                 | `srsName`    | Coordinates                                    |
| --------------------- | ------------ | ---------------------------------------------- |
| `EPSG:4326` (default) | `EPSG:4326`  | longitude first, as GML 2 writes the bare code |
| `EPSG:28992`          | `EPSG:28992` | RD New, by pyproj, to the millimetre           |
| `none`                | none         | longitude first, with nothing to say so        |

The first two are the same area, so a client can be checked to put them in the
same place; the third is ZOO's `Centroid`, which names no system at all.

### `breinstein-kml`

KML as tools write it (2026-10-26, #F5): four Placemarks in a Folder — a
polygon whose `description` is HTML with a script and an image in it, a point
with `ExtendedData` `Data` pairs, a line with `SchemaData`, and a
`MultiGeometry` of two points. Every coordinate carries an altitude. Labelled
`application/vnd.google-earth.kml+xml`.

### `breinstein-rd-link` and the `breinstein-rd` collection

A pygeoapi process cannot send `Content-Crs`; pygeoapi's OGC API - Features
can (2026-10-26, #F1). `breinstein-rd` is a features collection of three fixed
features in Utrecht — a polygon, a line and a point — stored in RD New
([pygeoapi/data/breinstein-rd.geojson](pygeoapi/data/breinstein-rd.geojson),
mounted by `compose/pygeoapi.yml`) and offered in RD New and CRS84. Asked for
with `crs=http://www.opengis.net/def/crs/EPSG/0/28992`, pygeoapi answers as
stored, with `Content-Crs: <http://www.opengis.net/def/crs/EPSG/0/28992>`;
asked for nothing, it reprojects to CRS84 with pyproj, by the same
seven-parameter shift the web client uses (0.17 mm apart).

`breinstein-rd-link` returns one output, always by reference: a link to that
query, in RD New by default or in CRS84 (its `crs` input). The link's target is
set per instance in the YAML, as for `breinstein-link`. Everything stays on
the local server: the blocking lane does not need the network.

A side effect worth knowing: with a features collection configured, pygeoapi
declares ten OGC API - Features conformance classes beside the Processes ones.
`packages/core/test/fixtures/pygeoapi/conformance.json` was re-captured with
them.

## Re-creating the stack after a config change

`up -d` alone will not pick up a change to a mounted config or a new plugin
file — the container has to be replaced:

```bash
docker compose -f infra/compose/pygeoapi.yml up -d --force-recreate
```

Jobs live in a TinyDB file inside the container (`/tmp/pygeoapi-process-manager.db`),
so they **survive a `restart`** and are **lost on a recreate**. Worth knowing
before wondering where a demo's job went.
