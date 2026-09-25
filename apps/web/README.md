# @breinstein/web

The client a person uses: pick a service, see its processes, fill in a form
generated from a process's description — drawing a bounding box or GeoJSON on
the map where one is asked for — run it in the foreground or the background, and
see the result or download it.

Built on the published core, [`@breinstein/oap-client`](../../packages/core),
and on nothing else of this repository's except the relay's wire contract.

## Running it

```bash
pnpm --filter @breinstein/web dev          # http://localhost:5173
```

That is enough for any server a browser may read. To run processes in the
background against a server that hides `Location` from web pages — which is
both reference servers (findings 0002, 0009) — start the relay as well and tell
the app where it is:

```bash
pnpm --filter @breinstein/relay build
RELAY_CONFIG=../../infra/relay/ci.json PORT=8787 pnpm --filter @breinstein/relay start
VITE_RELAY_URL=http://localhost:8787 pnpm --filter @breinstein/web dev
```

`VITE_RELAY_URL` is read at build time. Unset, there is no relay: every request
goes straight to the server and background jobs are found by polling, where the
server lets a page find them at all. See [apps/relay](../relay) and
[infra/relay](../../infra/relay).

The reference servers come from `infra/`:

```bash
docker compose -f infra/compose/pygeoapi.yml up -d --wait   # :5080 with CORS, :5081 without
./infra/zoo/zoo.sh up                                        # :5090
```

## Where the endpoints come from (T8)

1. **Configured**, from the relay's `GET /endpoints`, when `VITE_RELAY_URL` is
   set. They keep their configured `executeRoute`: an endpoint marked `relay`
   sends its background runs through the relay, which is what lets a page name
   the job. One marked `readRoute: "relay"` may also be _read_ through the
   relay, but only as a fallback the user confirms (below).
2. **Typed**, in the address field. A typed address is **always reached
   directly**: the relay only accepts the keys it was configured with, and is
   not a general proxy.

Which of the reference servers a page can read at all, measured in Chromium on
2026-09-23 (Task 7, Z1):

| Server         | Landing page, `/conformance`, `/processes`, a description |
| -------------- | --------------------------------------------------------- |
| pygeoapi :5080 | readable                                                  |
| pygeoapi :5081 | blocked (no CORS headers; finding 0049)                   |
| ZOO :5090      | blocked (no CORS headers; finding 0050)                   |

Connecting to a blocked server says so — "This server doesn't allow access
from a web page (no CORS headers). The attempt has been recorded." — and records
an `endpoint-access` observation.

### Direct first, then the relay after a click (phase 3)

For a configured endpoint with `readRoute: "relay"`, there is one more step.
The page still tries the server directly first. Only if that fails the way a
missing CORS header fails does it ask:

> This server sent no CORS headers, so a web page cannot read it directly.
> Reach it through the relay instead? This will be recorded as a finding.

**Use relay** reconnects through the relay's read route. Everything for that
endpoint then goes through it: the landing page, processes, descriptions, sync
and background runs, job status, results and Cancel job. A banner that cannot
be dismissed says so for as long as the connection lasts. **Cancel**, Escape or
closing the question in any other way is a decline, and the direct failure is
shown as before. Nothing ever switches route without the click. The choice is
not remembered: connecting again starts direct.

It lives in three places:

- `app/route-decision.ts` holds the rules;
- `relay/relay-fetch.ts` is the `fetch` handed to the core, which rewrites URLs
  under `baseUrl` onto the relay and refuses any other;
- the workflow reducer's offer state is the only way onto the route.

The core does not know the relay exists: to the core, it looks like a server
that sends perfect CORS headers.

In CI, `pygeoapi-nocors-relay` offers this for `:5081` and `zoo` for `:5090`.
`pygeoapi-nocors` offers nothing, so the unassisted failure stays visible.

## The screens

A single reducer, [`src/app/workflow.ts`](src/app/workflow.ts), owns the flow:
choose a service → processes → a process → running → result. The process screen
shows the description, how the process can run, and any warnings the core's
parser raised about the description, then the generated form.

Running:

- **Foreground by default**, with **Run in the background** where the process
  supports both; the one it supports when it supports one. A process that
  declares nothing says "The server did not state how this process can run;
  assuming synchronous".
- **Before anything is sent**, the checks the plan states cheaply: required
  fields, numeric bounds, `enum` membership, `maxLength`, coordinate counts,
  list lengths, and that raw JSON parses. Nothing else — the server is
  authoritative. Neither reference server validates inputs against its own
  schema (Z5, finding 0054), so these are the only checks a user gets.
- **Every declared output is named** in the request, with no format or
  transmission mode: "all of them, as the server prefers". The core never adds
  `outputs` itself, and ZOO refuses a body without it (finding 0025).
- **A server's refusal** is shown with its own words, and the input it names
  when its words name one.
- **Cancel job** is offered for a background run. Where neither the process nor
  the service advertises dismissal — pygeoapi advertises it nowhere (finding 0006) — the button says so, and every attempt is recorded with what had been
  advertised.

Results (T10): JSON is shown pretty-printed and collapsible, text is shown as
text and never rendered as markup, and everything else is offered as a download
with its media type, file name and size. Each output is shown separately.

A result that is GeoJSON — a FeatureCollection, a Feature or a bare geometry,
in longitude and latitude — is also drawn on the map in blue, beside the
geometry inputs it was sent, in the drawn input's amber and dashed; the map
moves to show both. It is recognised by what it is, not by its media type:
pygeoapi labels GeoJSON `application/geo+json`, ZOO's geometry services send
it as `application/json`. GeoJSON in projected coordinates is not drawn, and
the result says why ([`src/results/plottable.ts`](src/results/plottable.ts)).

An image result a browser shows by itself — PNG, JPEG, GIF, WebP — is shown
under Result as well as offered as a download. When the same results carry
exactly one such image and exactly one bounding box in CRS84, the image is also
placed on the map over that box, beneath the input's outline. That pairing is
this client's reading: the standard has no way to say one output is another's
extent, so with two images or two boxes nothing is placed.

The display limit (512 kB) applies to each output of a results document on its
own, so a base64 image carried in one does not push the JSON beside it into a
download. JSON over the limit is offered as a download but still read, so
GeoJSON too large to show — a few hundred buildings is already a megabyte — is
still drawn on the map. Collection references are Task 8.

## Generated forms — [`src/forms/`](src/forms)

Ported from Sam's prototype on `feat/T3-prototype-interface`, reviewed first:
[docs/reviews/forms-prototype-review.md](../../docs/reviews/forms-prototype-review.md).

- `resolve.ts` turns the core's parsed `ProcessDescription` into a **form
  plan**: plain data, one control per input, and a diagnostic for every input it
  could not turn into a proper control. It reads `required` and `multiple` from
  the core and re-derives nothing. It never throws.
- `matchers.ts` is the ordered chain that picks a control: bounding box,
  geometry, **complex input** (a `oneOf` of alternative encodings), refusals,
  `const`, `enum`, type. Anything it does not understand becomes a raw JSON
  editor, with the reason shown next to it.
- `encode.ts` turns form values into the request's `inputs`, and nothing else —
  the core's `execute()` builds the request.
- `validate.ts` and `defaults.ts`: the checks above, and the starting values.
  A required field starts at its schema default; an optional one starts empty
  and is left out, with the server's default shown as a hint. An optional
  boolean has three states — not set, yes, no — so it never overrides a
  server's default by being left alone.

The directory imports nothing from React, the DOM, the map or the relay, which
the `form-plan-is-framework-free` dependency-cruiser rule enforces. Promoting it
to the core, or to a `forms` subpath export, is then a move rather than a
rewrite.

### Bounding boxes and CRSs (T9)

The map and the typed fields both hold a box **longitude first** — west, south,
east, north — whatever the CRS. The encoder owns the wire order:

- CRS84 offered, or nothing said: sent as CRS84.
- Only EPSG:4326 offered (ZOO's `echo` is one): the axes are **swapped** to
  latitude-first, and the swap is recorded as an observation. ZOO relabels
  whatever CRS it is sent as its own default (finding 0051), so sending CRS84
  unswapped to it would not be a way out.
- Only a projected CRS offered: no map drawing and **no reprojection**. The
  coordinates are typed in that CRS's own units, or the whole value entered as
  JSON, and the situation is recorded.

The CRS is always sent, even when it is the default.

### GeoJSON

Built on Sam's drawing and file reader from `feat/T3-prototype-interface-2`.

- A **geometry** input (a `geojson-*` format, a `$ref` to a GeoJSON schema, or
  `application/geo+json`) holds GeoJSON text: drawn on the map, loaded from a
  file, or typed. `geometry.ts` puts what was drawn in the wrapper and geometry
  types the plan names: several polygons become a MultiPolygon only where the
  input takes one, and what does not fit is counted and said, not dropped.
- A **complex** input's JSON-object format can be drawn for too, as a
  FeatureCollection. That is how real services declare geometry: ZOO's Buffer
  and SAGA's polygon tools take GML or "an object". The user decides that the
  object is geometry; nothing guesses it from a title.
- A loaded file is refused when it is not WGS 84: a `crs` member naming
  anything else, or coordinates beyond ±180/±90, which in Dutch data means RD
  New (`geojson.ts`).
- On the wire it is `{ "value": <GeoJSON> }` (Requirement 20), like any object.
  pygeoapi hands that wrapper to the process unopened (finding 0052).

`test/forms/captured-requests.test.ts` checks the encoder against five requests
servers accepted, collected by Sam (`test/fixtures/forms/README.md`).

## The map — [`src/map/`](src/map)

MapLibre over PDOK's BRT-Achtergrondkaart ("standaard", EPSG:3857), which needs
no key and answers CORS requests from any origin (verified in Z6). The data is
Kadaster's, CC BY 4.0, credited on the map:

    https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png

A bounding-box field's **Draw on the map** puts the map in draw mode: drag a
rectangle, or click two corners, then move or resize it. A GeoJSON field's puts
a toolbar on the map with the tools its input allows — point, line, area, box —
and **Delete selected**; a finished shape is selected so it can be adjusted, and
Terra Draw's own corner and midpoint handles are kept out of the value (Sam's
fix). The drawn input is amber, so a result, which is blue, cannot be mistaken
for it. The draw mode is removed when the field stops drawing, when
another process is chosen, when a run starts, and on unmount.

Only this directory may import `maplibre-gl` or `terra-draw`, and it imports
nothing from the core: it is handed four numbers or some shapes, and hands the
same back.
Where the map cannot start — no WebGL — it says so, and the typed coordinates
remain the way in. MapLibre 6 looks for its worker next to its own module, which
a bundle moves, so Vite bundles the worker as an ES module and `MapView` hands
its URL over (`worker.format: "es"` in `vite.config.ts`).

## Observations, and the developer panel (T4)

Everything the client observes goes into one stream, redacted at creation — ids,
codes, schema keywords, CRS URIs and endpoints' origins and paths; never an
input value, a schema body, a query string or a response body:

- the core's own observations (discovery, descriptions, executions, jobs);
- `execute-route`: which route an execute took, from Task 6;
- `form`: every input the generator could not handle, with the schema keyword
  that caused it, and every change the encoder made on the way (an axis swap);
- `endpoint-access`: one per connection attempt. It records the direct outcome
  (always), whether the relay offers its read route, whether the user
  confirmed, how the relay attempt ended (`relayOutcome`, with the relay's own
  `relayReasonCode`), and `routeUsed`, which is `relay` only when that attempt
  worked;
- `cancel-job`: each Cancel job, and whether dismissal had been advertised.

The **Developer** section at the foot of the panel writes them to a file with
**Download session observations**. They are the raw material of the
form-generation failure catalogue. Open the page with `?developer` to have the
section open, which is also where Task 6's raw asynchronous-execution panel now
lives; the relay's browser tests drive it there.

## Tests

```bash
pnpm test          # Vitest: the form layer, the reducer, results, the map binding (stubbed)
pnpm test:e2e      # Playwright, Chromium, against pygeoapi :5080 and the relay
```

`test/forms/census.test.ts` snapshots the generator's output over every committed
process description, so any change to a matcher shows up as a reviewed diff.

## Not yet

- A choice of output format, or a media type for GeoJSON beyond what the
  description declares.
- Reprojection, and a choice of basemap.
- Collection references among the results (Task 8).
- The bundle is one chunk of about 1.4 MB, most of it MapLibre.
