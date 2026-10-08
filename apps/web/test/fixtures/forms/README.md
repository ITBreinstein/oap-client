# Execute requests sent to a real server

Four process descriptions captured from the pinned ZOO-Project, each paired with
an execute request we wrote and sent to it, and one hand-written description.
They let the encoder be tested against requests a server was actually sent, not
only against our reading of the specification. The idea and the harness are
Sam's; the test that uses them is `../../forms/captured-requests.test.ts`.

Every file here is ours. They replace captures copied from a third-party
repository that declares no licence.

## Provenance

|          |                                                                       |
| -------- | --------------------------------------------------------------------- |
| Server   | ZOO-Project, fork `46289f6` (`infra/zoo/pinned.env`), MIT             |
| Endpoint | `http://localhost:5090/ogc-api`, started with `./infra/zoo/zoo.sh up` |
| Captured | 2026-10-08                                                            |

| Directory                          | Process                   | What the request sends                                                                  | ZOO's answer                                         |
| ---------------------------------- | ------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `zoo-inline-csv/`                  | `SAGA.table_tools.3`      | two CSV tables inline, UTF-8, joined on their first column; three booleans              | `200`, the joined table (`execute.response.json`)    |
| `zoo-inline-las/`                  | `SAGA.pointcloud_tools.4` | a nine-point LAS 1.2 file inline, base64, made by `make-las.py`; two enums and a number | `500`, a kernel segfault (finding 0070)              |
| `zoo-inline-geojson-polygons/`     | `SAGA.shapes_polygons.5`  | a GeoJSON FeatureCollection of three squares, as the `type: object` branch; four others | `200` with no output: `{}` (finding 0071)            |
| `zoo-linked-gml/`                  | `Contains`                | a polygon and a point by reference, `square.gml` and `point.gml` beside it              | not yet sent: see below                              |
| `hand-written-undocumented-array/` | none                      | an array input with no `items`, entered item by item                                    | not sent: no reference server declares such an input |

`description.json` is the server's answer to `GET /processes/{id}`, and
`execute.response.json` its answer to the execute. `execute.request.json` is
what was sent, written by hand. The two ZOO failures are not caused by the
request: the request each one replaced fails the same way on the same server.

`zoo-linked-gml/execute.request.json` names `host.docker.internal:8099`, where
ZOO would fetch the two GML files from a local file server. That capture has
not been run yet, so this scenario has no `execute.response.json`.

## Shape of these files

The capture envelope wraps the HTTP message, with the body parsed:

```jsonc
// description.json, execute.response.json
{ "status": 200, "headers": { … }, "final_url": "…", "body": { /* the description */ } }

// execute.request.json
{ "method": "POST", "url": "…", "headers": { … }, "body": { /* inputs, outputs, response */ } }
```

The hand-written files carry only `body`. They are excluded from Prettier for
the same reason as the core's fixtures: a diff after re-capturing should mean
the capture changed, not that a formatter ran.

## Reproducing a capture

```bash
./infra/zoo/zoo.sh up
curl -s -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' \
  --data-binary "$(jq .body zoo-inline-csv/execute.request.json)" \
  http://localhost:5090/ogc-api/processes/SAGA.table_tools.3/execution
```

ZOO writes each job's results into the checkout's `docker/com/`, which then
makes `zoo.sh up` refuse to start until they are moved out.
