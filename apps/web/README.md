# @breinstein/web

The client a person uses: pick a service, see its processes, fill in a form
generated from a process's description — drawing a bounding box on the map where
one is asked for — run it in the foreground or the background, and see the
result or download it.

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
   the job.
2. **Typed**, in the address field. A typed address is **always reached
   directly** — the relay only accepts the keys it was configured with, and is
   not a proxy.

Which of the reference servers a page can read at all, measured in Chromium on
2026-09-23 (Task 7, Z1):

| Server         | Landing page, `/conformance`, `/processes`, a description |
| -------------- | --------------------------------------------------------- |
| pygeoapi :5080 | readable                                                  |
| pygeoapi :5081 | blocked (no CORS headers; finding 0049)                   |
| ZOO :5090      | blocked (no CORS headers; finding 0050)                   |

Connecting to a blocked server says so — "This server doesn't allow access
from a web page (no CORS headers). The attempt has been recorded." — and records
an `endpoint-access` observation. There is no CORS proxy, on purpose.

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
GeoJSON on the map, images and collection references are Task 8.

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

## The map — [`src/map/`](src/map)

MapLibre over PDOK's BRT-Achtergrondkaart ("standaard", EPSG:3857), which needs
no key and answers CORS requests from any origin (verified in Z6). The data is
Kadaster's, CC BY 4.0, credited on the map:

    https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png

A bounding-box field's **Draw on the map** puts the map in draw mode: drag a
rectangle, or click two corners, then move or resize it. The drawn input is
amber, so nothing Task 8 shows as a result can be mistaken for it. The draw mode
is removed when the field stops drawing, when another process is chosen, when a
run starts, and on unmount.

Only this directory may import `maplibre-gl` or `terra-draw`, and it imports
nothing from the core: it is handed four numbers and hands four numbers back.
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
- `endpoint-access`: how connecting went, and whether the address was typed;
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

- Drawing geometries other than a bounding box: a geometry input is a raw JSON
  editor with a "not yet supported" note.
- Reprojection, and a choice of basemap.
- Results on the map, images and collection references (Task 8).
- The bundle is one chunk of about 1.4 MB, most of it MapLibre.
