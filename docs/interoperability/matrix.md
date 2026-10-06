# Interoperability matrix

Generated 2026-10-06 by `tools/build-matrix.mjs` from 64 findings and 3 endpoints' observations. Do not edit by hand.

This copy covers the two reference servers the project runs, pygeoapi and ZOO-Project: their findings, and observations made against them on a local stack.

## Findings

One table per area. A row is a capability, a column a server; each cell lists the outcomes recorded and the findings behind them.

### links

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| advertised-href-authority |  | conformant (0008) |
| execute-link-relation | conformant (0029) | conformant (0029) |
| job-document-links | non-conformant (0042) |  |
| link-relation-forms | non-conformant (0005) | conformant (0011) |
| process-list-paging | non-conformant (0018) | non-conformant (0019) |
| self-link | conformant (0021) | non-conformant (0017); conformant (0021) |

### conformance

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| conformance-declaration | undeclared (0006) |  |

### negotiation

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| dismiss | non-conformant (0037) |  |
| execute-content-negotiation | conformant (0030) | conformant (0030) |
| format-selection |  | non-conformant (0012) |
| json-content-negotiation | conformant (0007) |  |
| results-retrieval | non-conformant (0036) |  |

### errors

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| bare-path-exception |  | non-conformant (0010) |
| not-found |  | non-conformant (0014) |
| problem-details | non-conformant (0001) | non-conformant (0013, 0055) |
| process-description |  | declared-not-working (0020) |
| qualified-input-value |  | non-conformant (0062) |
| unsupported-media-type |  | non-conformant (0015) |

### execution

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| async-response-body | non-conformant (0004) |  |
| bounding-box-input | conformant (0023) | conformant (0023); non-conformant (0051) |
| callback-delivery-failure | declared-not-working (0047) |  |
| callback-job-identity | conformant (0048) | conformant (0048) |
| execute-request-body |  | non-conformant (0025) |
| input-arity-validation | non-conformant (0031) | non-conformant (0031) |
| input-by-reference | non-conformant (0058) | non-conformant (0053, 0061) |
| input-validation | non-conformant (0054) | non-conformant (0016, 0054) |
| output-selection | non-conformant (0028) |  |
| process-description | declared-not-working (0059) | undeclared (0022); non-conformant (0056, 0063, 0065) |
| process-execution |  | declared-not-working (0066) |
| qualified-input-value | non-conformant (0052) |  |
| sync-execution-response | non-conformant (0024) |  |

### jobs

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| async-execution |  | declared-not-working (0044) |
| dismiss | non-conformant (0035) | non-conformant (0035, 0043) |
| job-document-shape | conformant (0003) |  |
| job-failure-reporting | non-conformant (0034) | non-conformant (0034) |
| job-list-filtering | non-conformant (0038) |  |
| job-status-vocabulary | non-conformant (0032) |  |
| poll-pacing | unsupported (0033, 0045) | unsupported (0033, 0045) |

### results

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| response-negotiation | non-conformant (0027) | non-conformant (0060) |
| result-media-type |  | non-conformant (0026) |
| results-retrieval | non-conformant (0041) | non-conformant (0041) |

### cors

| capability | pygeoapi | zoo-project |
| --- | --- | --- |
| async-execution | blocked (0039) |  |
| browser-access | unsupported (0049) | unsupported (0050) |
| cors-headers |  | unsupported (0009) |
| cors-preflight | conformant (0057) |  |
| dismiss | non-conformant (0040) | non-conformant (0040) |
| location-header-exposure | non-conformant (0002) |  |

### Every finding

| id | server | severity | confidence | client impact | title |
| --- | --- | --- | --- | --- | --- |
| 0001 | pygeoapi | major | high | handled | pygeoapi exception bodies are not RFC 7807 problem documents |
| 0002 | pygeoapi | blocking | high | blocked | pygeoapi with CORS on does not send Access-Control-Expose-Headers, hiding Location from browsers |
| 0003 | pygeoapi | minor | high | handled | The job document's `type` member is "process", colliding with RFC 7807's `type` |
| 0004 | pygeoapi | minor | medium | handled | pygeoapi returns a `null` body with the async 201, not a job status document |
| 0005 | pygeoapi | major | medium | handled | pygeoapi advertises conformance in the short form and processes in the long OGC URI form, on the same landing page |
| 0006 | pygeoapi | major | high | handled | pygeoapi supports dismiss and job-list but declares neither conformance class |
| 0007 | pygeoapi | major | high | handled | pygeoapi answers a browser-like Accept header with HTML at 200, and `*/*` with JSON |
| 0008 | zoo-project | major | high | none | ZOO-Project builds every advertised href from a configured root URL and never consults the request |
| 0009 | zoo-project | blocking | high | degraded | ZOO-Project sends no CORS headers for any origin, including the one its own configuration allows |
| 0010 | zoo-project | major | medium | handled | ZOO-Project answers the landing page without its trailing slash with 400 and a WPS 1.0 XML exception report |
| 0011 | zoo-project | informational | high | handled | ZOO-Project writes conformance and processes in the long OGC URI form, the mirror image of pygeoapi |
| 0012 | zoo-project | minor | medium | handled | ZOO-Project ignores Accept entirely and answers the standard f=json parameter with 400 |
| 0013 | zoo-project | minor | high | handled | ZOO-Project exception bodies are RFC 7807 shaped but the type is a bare token on every exception except NoSuchProcess |
| 0014 | zoo-project | major | high | degraded | ZOO-Project answers an unknown path under the API with 400, not 404 |
| 0015 | zoo-project | major | high | handled | ZOO-Project segfaults on a POST carrying a content type it does not expect |
| 0016 | zoo-project | major | medium | none | ZOO-Project reports an input its own service rejected as 500, not 400 |
| 0017 | zoo-project | minor | medium | none | ZOO-Project process descriptions advertise an execute link but no self link |
| 0018 | pygeoapi | major | high | degraded | pygeoapi cuts /processes at ten with no next link, and silently ignores offset |
| 0019 | zoo-project | minor | high | handled | ZOO-Project pages the process list with `skip`, not the `offset` Common defines |
| 0020 | zoo-project | major | high | degraded | ZOO-Project lists two processes whose descriptions answer 500 with an Apache HTML page |
| 0021 | pygeoapi, zoo-project | informational | high | none | Both servers advertise a self link on each process list entry, including ZOO |
| 0022 | zoo-project | minor | high | handled | ZOO-Project carries `extended-schema` and `raw_schema1` alongside `schema` on 28% of inputs |
| 0023 | pygeoapi, zoo-project | informational | medium | none | A bounding-box input is an inline object with `format: "ogc-bbox"`, not a $ref |
| 0024 | pygeoapi | major | high | handled | pygeoapi sends a Location header on every synchronous execution, including on 400s |
| 0025 | zoo-project | blocking | high | degraded | ZOO-Project cannot parse an execute body that carries only `inputs` |
| 0026 | zoo-project | major | high | handled | ZOO-Project labels raw-mode results `application/json` whatever they actually are |
| 0027 | pygeoapi | major | high | none | pygeoapi's document response is an array of outputs, and `response: "raw"` is ignored |
| 0028 | pygeoapi | minor | high | none | pygeoapi silently ignores the `outputs` block, including modes it never declared |
| 0029 | pygeoapi, zoo-project | informational | high | handled | Both servers advertise the execute endpoint only as the long OGC relation URI |
| 0030 | pygeoapi, zoo-project | informational | medium | none | Neither server varies the execute response by Accept, including for a browser's header |
| 0031 | pygeoapi, zoo-project | major | medium | degraded | An array sent for a single-valued input leaks a Python traceback from ZOO and is stringified by pygeoapi |
| 0032 | pygeoapi | major | high | handled | pygeoapi reports a job as accepted for its entire execution and never as running |
| 0033 | pygeoapi, zoo-project | minor | high | handled | Neither reference server sends Retry-After on any job status response |
| 0034 | pygeoapi, zoo-project | major | high | degraded | Neither server sends an exception member on a failed job; the failure is prose in message |
| 0035 | pygeoapi, zoo-project | major | high | handled | Both servers delete a dismissed job outright rather than reporting status dismissed |
| 0036 | pygeoapi | major | high | handled | pygeoapi's job results endpoint content-negotiates and answers HTML for Accept */* |
| 0037 | pygeoapi | minor | high | handled | pygeoapi returns a JSON job document from DELETE under Content-Type text/html |
| 0038 | pygeoapi | major | high | handled | pygeoapi accepts processID and status filters on the job list and silently ignores them |
| 0039 | pygeoapi | blocking | high | degraded | A browser cannot name the job it just started against pygeoapi, on either port |
| 0040 | pygeoapi, zoo-project | major | high | degraded | Job dismissal needs a CORS preflight, which only the CORS-enabled pygeoapi port answers |
| 0041 | pygeoapi, zoo-project | major | high | handled | ZOO answers /results for a failed job with 200 and an exception body; pygeoapi answers 400 |
| 0042 | pygeoapi | minor | high | handled | pygeoapi job documents carry no self link, and a failed job carries no links at all |
| 0043 | zoo-project | minor | low | degraded | ZOO intermittently closes the connection with no response when dismissing a running job |
| 0044 | zoo-project | major | high | none | ZOO asynchronous capacity decays about one worker per job run and never recovers |
| 0045 | pygeoapi, zoo-project | major | high | handled | With no server sending Retry-After, a parser defect that inverts its meaning went undetected |
| 0047 | pygeoapi | major | high | degraded | pygeoapi lets an undeliverable callback stall the job, or turn a successful one into failed |
| 0048 | pygeoapi, zoo-project | major | high | handled | Neither server's success or failure callback names the job; only ZOO's in-progress callback does |
| 0049 | pygeoapi | blocking | high | degraded | pygeoapi with cors false is blocked in a browser for every operation; only the relay's opt-in read route, which proxies it, makes it usable |
| 0050 | zoo-project | blocking | high | degraded | ZOO-Project cannot be used from a browser at all — no execute, no read; only the relay's opt-in read route, which proxies it, makes it usable |
| 0051 | zoo-project | major | high | handled | ZOO-Project discards the CRS sent with a bounding box and relabels the box with its own default, and accepts three coordinates |
| 0052 | pygeoapi | major | medium | degraded | pygeoapi hands a qualified input value to the process as the wrapper object, not its value |
| 0053 | zoo-project | major | high | none | ZOO-Project runs the process with an empty input when a by-reference input cannot be fetched, and never says the fetch failed |
| 0054 | pygeoapi, zoo-project | major | high | handled | Neither server validates execute inputs against the process description; ZOO checks only that required inputs are present |
| 0055 | zoo-project | minor | high | degraded | ZOO-Project answers a crashed SAGA process with Apache's HTML error page, including for an input inside its declared range |
| 0056 | zoo-project | minor | medium | handled | 457 of ZOO-Project's SAGA inputs are booleans whose enum lists the strings "true" and "false", a schema no value satisfies |
| 0057 | pygeoapi | informational | high | none | pygeoapi with cors true grants every origin and every request header a preflight asks for, and exposes no response header |
| 0058 | pygeoapi | major | high | none | pygeoapi hands a by-reference input to the process as the link, unresolved |
| 0059 | pygeoapi | minor | high | handled | pygeoapi describes every process with the server's execution modes and transmission modes, not the process's own |
| 0060 | zoo-project | major | high | none | ZOO-Project answers a raw request for outputs by reference with the value itself (one output) or a multipart whose links are in the part bodies (two), never 204 with Link headers |
| 0061 | zoo-project | major | medium | none | ZOO-Project reuses its cached copy of a by-reference input across executions, and never asks whether it changed |
| 0062 | zoo-project | major | high | handled | ZOO-Project's kernel segfaults on a base64 raster sent without `"encoding": "base64"` |
| 0063 | zoo-project | minor | high | handled | ZOO-Project puts a character set (`utf-8`, `UTF-8`, `ascii`) in `contentEncoding` |
| 0065 | zoo-project | major | medium | none | ZOO-Project's OGR services declare a GML polygon schema, but accept a polygon only five levels deep inside a feature collection |
| 0066 | zoo-project | major | high | none | The ZOO-Project image points OTB at a directory it does not contain, so every OTB process it lists answers 500 |

## Browser access

Whether a web page can use the server is decided by the direct attempt alone. A server that worked only through the relay is not usable from a browser. The relay attempt only tells a CORS block apart from a server that was down.

| endpoint | usable from a web page | what the attempts showed | relay read route | routes used | relay reason codes | attempts |
| --- | --- | --- | --- | --- | --- | --- |
| http://localhost:5080/ (pygeoapi-cors) | yes | reachable directly ×2 | no | direct |  | 2 |
| http://localhost:5081/ (pygeoapi-nocors, pygeoapi-nocors-relay) | **no** | no readable answer (CORS or down, unconfirmed) ×1; no CORS (confirmed through the relay) ×1 | yes, confirmed 1× | none, relay |  | 2 |
| http://localhost:5090/ogc-api (zoo) | **no** | no CORS (confirmed through the relay) ×1 | yes, confirmed 1× | relay |  | 1 |

## Process census

From **Describe every process**. Listed but not described means the description could not be read, or the census was not run to the end.

| endpoint | listed | described | not described | declared sync / async / dismiss | no jobControlOptions | inputs | schema shapes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| http://localhost:5080/ | 14 | 14 | 0 | 14 / 14 / 0 | 0 | 27 | inlineType 25, enumerated 1, ref 1, composed 1, contentMediaType 1, formatted 6, absent 0 |
| http://localhost:5081/ | 14 | 14 | 0 | 14 / 14 / 0 | 0 | 27 | inlineType 25, enumerated 1, ref 1, composed 1, contentMediaType 1, formatted 6, absent 0 |
| http://localhost:5090/ogc-api | 703 | 701 | 2 | 701 / 701 / 701 | 0 | 5098 | inlineType 3662, enumerated 1279, ref 0, composed 1436, contentMediaType 0, formatted 1285, absent 0 |

### What form generation could not do as the schema asked

Each process, input and code counted once.

| endpoint | code | inputs |
| --- | --- | --- |
| http://localhost:5090/ogc-api | contradictory-schema | 457 |
| http://localhost:5090/ogc-api | bbox-axis-swapped | 1 |

## Execution modes

The mode asked for against what the server did (`preferenceApplied`). A sync run sends no `Prefer`, so a job coming back counts as ambiguous, not ignored. `route` is the route the execute took. Through the relay, the relay read the headers, so whether a page can read them is counted for `direct` only (—). `unrecorded`: the export predates the route being recorded.

| endpoint | asked | route | runs | honoured | ignored | ambiguous | no answer | Preference-Applied readable | Location readable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| http://localhost:5080/ | async | direct | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| http://localhost:5080/ | async | relay | 4 | 3 | 1 | 0 | 0 | — | — |
| http://localhost:5080/ | sync | direct | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| http://localhost:5081/ | async | relay | 3 | 2 | 1 | 0 | 0 | — | — |
| http://localhost:5081/ | sync | relay | 2 | 0 | 0 | 2 | 0 | — | — |
| http://localhost:5090/ogc-api | async | relay | 2 | 2 | 0 | 0 | 0 | — | — |
| http://localhost:5090/ogc-api | sync | relay | 1 | 1 | 0 | 0 | 0 | — | — |

## Sources

- http://localhost:5080/: oap-client-observations-localhost_5080-2026-10-06T12-39-11-768Z.json
- http://localhost:5081/: oap-client-observations-localhost_5081-2026-10-06T12-39-18-949Z.json
- http://localhost:5090/ogc-api: oap-client-observations-localhost_5090_ogc-api-2026-10-06T12-41-38-949Z.json
