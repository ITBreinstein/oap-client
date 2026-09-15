# Captured execute requests

Six process descriptions, each paired with an execution request that the server
in question **accepted** — or, for the two under `validation/` upstream, that it
parsed and then refused on its own grounds rather than rejecting as malformed.

They exist so the input encoder can be tested against requests that really
worked, instead of against our own reading of the specification. The encoder is
the one place in this app that decides bare-versus-qualified, media types and
array-ness, and none of those are fully derivable from a process description —
so a test written from the spec would only confirm that the encoder agrees with
whoever wrote it.

## Provenance

|            |                                                      |
| ---------- | ---------------------------------------------------- |
| Repository | <https://github.com/Gouwe-Gozer/ogc-processes-tests> |
| Commit     | `c2ca9ddec60d163fb1b42808883d383c5fd849d8`           |
| Copied     | 2026-09-15                                           |

| Directory here                 | Scenario there                                                        |
| ------------------------------ | --------------------------------------------------------------------- |
| `bgt-numeric-ranges/`          | `scenarios/forms/inputs/bgt-prototype/numeric-ranges`                 |
| `zoo-inline-csv/`              | `scenarios/forms/inputs/zoo-local/inline-csv`                         |
| `zoo-inline-geojson-polygons/` | `scenarios/forms/inputs/zoo-local/inline-geojson-polygons`            |
| `zoo-linked-gml/`              | `scenarios/forms/inputs/zoo-local/linked-gml-polygon-and-point`       |
| `directed-undocumented-array/` | `scenarios/forms/validation/directed-local/undocumented-array-length` |
| `zoo-inline-las/`              | `scenarios/forms/validation/zoo-local/inline-las-point-cloud`         |

`01-get-description.response.json` is copied as `description.json` and the
execute request as `execute.request.json`; nothing else is changed. They are
excluded from Prettier for the same reason as the core's fixtures — reformatting
destroys the evidence, and a diff after re-copying should mean the capture
changed, not that a formatter ran.

Copies drift. The commit above is what makes a disagreement diagnosable rather
than mysterious. Worth revisiting whether these belong beside the core's captures
in `packages/core/test/fixtures/` instead, given `apps/web` already reads from
there — a second copy of the same kind of evidence is the thing most likely to go
stale.

## Shape of these files

The capture envelope wraps the real HTTP message:

```jsonc
// description.json
{ "status": 200, "headers": { … }, "final_url": "…", "body": { /* the description */ } }

// execute.request.json
{ "method": "POST", "url": "…", "headers": { … }, "body": { /* inputs, outputs, response */ } }
```

So the process description is at `.body`, and the request body — what the encoder
must reproduce — is at `.body.inputs`.

## One deliberate difference from these captures

Every ZOO request here nests format information inside `format`:

```json
{ "value": "id,name\n1,Alkmaar\n", "format": { "mediaType": "text/csv", "encoding": "utf-8" } }
```

We emit the standard OGC form instead, with those keys beside `value`. ZOO's
kernel accepts both: `checkCorrespondingJFields` runs on the request object
itself, and its alias table folds `mediaType` and `contentMediaType` onto the
same internal `mimeType` as the nested spelling. Verified against the fork SHA
that `infra/zoo/pinned.env` deploys, where that parser is byte-identical to the
checkout's `HEAD`.

The tests therefore normalise the nested form to the flat one before comparing.
That normaliser has its own test, because one that is too eager would make every
other assertion in the suite pass for free.
