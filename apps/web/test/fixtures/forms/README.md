# Captured execute requests

Five process descriptions, each paired with an execute request the server
**accepted**, or, for the two under `validation/` upstream, one it parsed and
then refused on its own grounds rather than as malformed.

They let the encoder be tested against requests that worked, not only against
our reading of the specification. Collected and first wired up by Sam on
`feat/T3-prototype-interface-2`; the test that uses them is
`../../forms/captured-requests.test.ts`.

## Provenance

|            |                                                      |
| ---------- | ---------------------------------------------------- |
| Repository | <https://github.com/Gouwe-Gozer/ogc-processes-tests> |
| Commit     | `c2ca9ddec60d163fb1b42808883d383c5fd849d8`           |
| Copied     | 2026-09-15 (by Sam), into this directory 2026-09-25  |

| Directory here                 | Scenario there                                                        |
| ------------------------------ | --------------------------------------------------------------------- |
| `zoo-inline-csv/`              | `scenarios/forms/inputs/zoo-local/inline-csv`                         |
| `zoo-inline-geojson-polygons/` | `scenarios/forms/inputs/zoo-local/inline-geojson-polygons`            |
| `zoo-linked-gml/`              | `scenarios/forms/inputs/zoo-local/linked-gml-polygon-and-point`       |
| `directed-undocumented-array/` | `scenarios/forms/validation/directed-local/undocumented-array-length` |
| `zoo-inline-las/`              | `scenarios/forms/validation/zoo-local/inline-las-point-cloud`         |

`01-get-description.response.json` is copied as `description.json` and the
execute request as `execute.request.json`; nothing else is changed. They are
excluded from Prettier for the same reason as the core's fixtures: a diff after
re-copying should mean the capture changed, not that a formatter ran.

## Shape of these files

The capture envelope wraps the HTTP message:

```jsonc
// description.json
{ "status": 200, "headers": { … }, "final_url": "…", "body": { /* the description */ } }

// execute.request.json
{ "method": "POST", "url": "…", "headers": { … }, "body": { /* inputs, outputs, response */ } }
```

## Where we differ from these captures, on purpose

- **Format members.** Every ZOO request here nests them:
  `{ "value": "…", "format": { "mediaType": "text/csv", "encoding": "utf-8" } }`.
  We send the standard's flat form, `mediaType` and `encoding` beside `value`.
  Sam verified that ZOO's kernel folds both onto the same internal field; the
  test normalises the nested form before comparing, and that normaliser has its
  own test.
- **A JSON object's media type.** `zoo-inline-geojson-polygons` names
  `application/json` for the FeatureCollection it sends to a branch declared
  only as `type: object`. We send `{ "value": … }` without one, since the
  description declares none. The pinned ZOO answers the same either way
  (checked 2026-09-25, `echo` and `SAGA.shapes_polygons.5`).
