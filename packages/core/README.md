# @breinstein/oap-client

A runtime-neutral [OGC API - Processes](https://ogcapi.ogc.org/processes/) client.

**Shipped:** service discovery, conformance and capabilities, process listing
and descriptions, synchronous and asynchronous execution, job status, polling,
results retrieval, dismissal, and the job list.

**Not yet shipped:** execution callbacks (the `subscriber` member) and the relay
that receives them. Polling is the baseline and works everywhere; callbacks are
an optimisation on top of it, and the client is designed to stay useful with the
relay switched off.

```bash
pnpm add @breinstein/oap-client
```

```ts
import { createClient } from "@breinstein/oap-client";

const client = createClient({ baseUrl: "https://example.org/ogc" });

const { processes } = await client.listProcesses();
const summary = processes.find((p) => p.id === "hello-world");
if (summary === undefined) throw new Error("no such process on this service");

const description = await client.getProcess(summary.id, { summary });

const execution = await client.execute(description.id, {
  inputs: { name: "world" },
  description,
});

if (execution.kind === "immediate") {
  console.log(execution.response.mediaType, await execution.response.json());
} else {
  const status = await client.waitForJob(execution.job.statusUrl, {
    onStatus: (s) => console.log(s.status, s.progress),
  });
  if (status.status === "successful") {
    const { envelope } = await client.getResults(execution.job.statusUrl, { status });
    console.log(envelope.mediaType, await envelope.json());
  } else {
    console.error("job did not succeed:", status.status, status.message);
  }
}
```

## The HTTP boundary

`src/http/` is the only part of the package that calls `fetch`, and it is split
three ways on purpose.

**`send()` — the transport.** URL and options in, a `ResponseEnvelope` out. It
does not retry, poll, back off or interpret, and **it does not throw on 4xx or
5xx**: a 404 is information. Only a request that never produced a response
throws — `AbortError` if your signal fired, otherwise `TransportError`.

A browser CORS block and a dead host are the same opaque `TypeError`, by design;
the browser will not tell you which. `TransportError` therefore records
`crossOrigin` — whether the request left the page's origin at all — and leaves
the inference to whoever is diagnosing. Off-browser it is `undefined`.

**`ResponseEnvelope` — the evidence.** The final URL and the requested one,
status, the raw `Headers`, the parsed media type (`+json` included, so
`application/geo+json` reads as JSON), `Content-Crs`, the `Content-Disposition`
filename, `Retry-After` in milliseconds from either wire format, `Location`
resolved against the _final_ URL, and the `Link` header.

Its readers are read-once-safe: an HTTP body streams exactly once, so the first
reader buffers it and `json()`, `text()`, `blob()` and `arrayBuffer()` all
derive from that buffer, in any order, any number of times. Bodies declaring
more than `maxBufferBytes` are not buffered at all; there, only `blob()` works.

The envelope has **no `ok` field**, deliberately. Whether a response is usable
is a judgement that needs the body:

**`classify()` — the judgement.** One of three outcomes:

| Outcome      | Means                                                           |
| ------------ | --------------------------------------------------------------- |
| `ok`         | usable                                                          |
| `exception`  | the body is a problem document (RFC 7807), _at any status_      |
| `http-error` | status >= 400 with no problem document; carries a `bodyPreview` |

A **200 carrying a problem document** is an `exception`, not `ok`. Servers do
this — a gateway rewrites the status, or a framework serialises an exception
through a success path — and a status check reports it as success, so the
failure surfaces later as a missing field somewhere unrelated.

Detecting one is not simply "has a `type` or `title`". Both members collide with
ordinary payloads: a job document is `{"type": "process", ...}` and every
process description carries a `title`. A body qualifies when the server declared
`application/problem+json`, or the wire status is already >= 400, or `type` is
URI-shaped, or the body itself claims a failing numeric `status`.

The wire status and the body's claimed status are kept separate and never
reconciled. Servers disagree with themselves, and the disagreement is a finding.

Classification never throws. A body that will not parse simply is not a problem
document.

**`requireOk()`** classifies and throws a `ProcessesError` unless the outcome is
`ok`, carrying the outcome, URL, wire status, parsed problem and the envelope
itself. Two operations deliberately bypass it and call `classify()` directly: a
**failed job** is a valid 200 whose document must reach the caller, and a
**capability probe** treats a 405 on `DELETE /jobs/{id}` as the answer.

## Discovery: `inspect()`

```ts
import { createClient, findLink } from "@breinstein/oap-client";

const client = createClient({ baseUrl: "http://localhost:5080" });
const service = await client.inspect();

service.title; // "pygeoapi (CORS enabled)"
service.url; // "http://localhost:5080/"  — after redirects
service.capabilities; // { sync: true, async: true, dismiss: false, callback: true, … }

// Navigate by what the server advertised, not by building a path.
findLink(service.links, "processes")?.href; // "http://localhost:5080/processes"
```

`inspect()` fetches the landing page, follows its conformance link, and derives
capabilities. Pass a `signal` to cancel it; it is threaded into both requests, so
a user who corrects a mistyped URL cannot have the first lookup race the second.

### Follow links; do not build paths

`${baseUrl}/processes` breaks the first time a server mounts its API behind a
gateway or under a path prefix, and you find out during a demo. Every href is
resolved against `ResponseEnvelope.url` — the URL the document was **served**
from, after redirects — never the URL you typed:

```
typed:   https://demo.example.nl/oapi      server 301s to add the slash
served:  https://demo.example.nl/oapi/
link:    { "rel": "processes", "href": "processes" }

new URL("processes", "…/oapi")   → https://demo.example.nl/processes        404
new URL("processes", "…/oapi/")  → https://demo.example.nl/oapi/processes   ✓
```

That is RFC 3986 §5.2.3: without a trailing slash the last segment is a file and
gets replaced. The user-supplied base URL is deliberately not a parameter of the
resolver — what it cannot reach, it cannot use by mistake.

Links from the `Link` **header** and the document **body** are merged and
deduped, because servers are inconsistent about which they use. A malformed link
entry is skipped and recorded, never thrown: one bad link must not take down
discovery of the other eleven.

### Relation matching tolerates both spellings

OGC registers its relations as full URIs; IANA registers short names; servers
pick either. `findLink` matches both, and it is not defensive programming —
pygeoapi 0.21 advertises **conformance under the short name** and **processes
under the long OGC URI**, on the same landing page. Either form alone finds one
and misses the other.

Where several links share a relation, `application/json` wins, then any `+json`
suffix type, then an untyped link, then the first match. An untyped link
outranks a `text/html` one because unknown beats known-wrong.

### JSON is requested explicitly, and HTML is a failure

Every GET sends `Accept: application/json`. `classify()` calls a `200 text/html`
landing page `ok` — correctly, nothing went wrong at the HTTP level — so
checking the media type is this layer's job:

```ts
requireJson(envelope); // throws NotJsonError unless application/json or a +json suffix
```

If a server ignores `Accept` and answers non-JSON, the request is retried
**once** with `?f=json` appended, preserving existing query parameters. `f=json`
is never sent on the first attempt: it is an OGC convention, not a normative
requirement, and appending it blindly risks colliding with a server's own `f`
handling. If the retry is non-JSON too, `NotJsonError`. Which path succeeded is
reported — "ignores `Accept`, requires `f=json`" is an interoperability finding.

### Capabilities are advertised, assumed, or neither

```ts
interface ServiceCapabilities {
  sync: boolean; // ASSUMED — derived from Core; no conformance class covers it
  async: boolean; // ASSUMED — must be probed before it is believed
  dismiss: boolean; // ADVERTISED by its own conformance class
  callback: boolean; // ADVERTISED by its own conformance class
  rawConformance: readonly string[]; // every URI as received
}
```

In Part 1 v1.0 `dismiss` and `callback` are conformance classes but sync and
async execution are not — both live inside Core, so no server can tell you it
honours `Prefer: respond-async`. Those two fields are optimism, and the type
says so.

**Capabilities are a UI convenience, never a gate.** A `false` means "not
declared", which is not "not supported": pygeoapi 0.21 answers
`DELETE /jobs/{id}` with a 200 and `GET /jobs` with a 200 while declaring
neither conformance class. A client that gated on `capabilities.dismiss` would
never send the request, and would never discover that. Nothing in this layer
throws over a missing class.

Conformance URIs are **parsed**, not string-compared — the version lives inside
the URI, so whole-string matching would read every draft-v2 URI as "unknown".
Unparseable URIs survive in `rawConformance`; evidence is never discarded.

A service with a valid landing page but a broken or missing conformance document
is **degraded, not dead**: capabilities come back all-`false`, an observation is
recorded, and the caller proceeds.

### Observations

Pass `onObservation` to receive structured records of what was seen — landing
page fetched, whether the `f=json` fallback was needed, whether the conformance
link was advertised or guessed, class counts, and each skipped link:

```ts
await client.inspect({ onObservation: (o) => matrix.record(o) });
```

URLs are redacted to origin and path at the point of creation, not at the sink,
so a credential in a query string cannot leak through a log line. A throwing
sink is swallowed: a broken logger is not a broken service.

## Processes: `listProcesses()` and `getProcess()`

```ts
const client = createClient({ baseUrl: "http://localhost:5080" });

const list = await client.listProcesses();
list.processes[0].id; // "hello-world"
list.processes[0].execution.async; // true
list.processes[0].execution.defaulted; // false — the server actually said so
list.truncated; // false
list.numberTotal; // undefined here; 703 against ZOO

const process = await client.getProcess("hello-world", { summary: list.processes[0] });
process.inputs[0]; // { id: "name", minOccurs: 1, required: true, multiple: false, schema: … }
process.outputs[0].schema["contentMediaType"]; // "application/json"
```

Neither method needs `inspect()` to have been called first — they run discovery
themselves and remember the resolved list URL for the life of the client. Both
take a `signal`.

### The core preserves; the layer above interprets

Deciding that one input deserves a number field and another a map draw tool is
**not** this package's job. Its obligation is narrower and stricter: never
discard anything that decision will need.

So the `schema` member of every input and output comes back **deep-equal to what
the server sent**. No key filtering, no defaulting, no normalising, no rewriting
of `$ref` into an absolute URL, and no dereferencing — following a `$ref` means
a second request, to a third-party host, for a possibly-YAML document, from a
browser CORS will block.

`JsonSchema` is therefore an open index signature with no named members, and
that is deliberate. Naming `type?: string` would be a claim this layer cannot
keep: nothing here checks it, and a server that sends `"type": 42` would hand
you a value typed `string` that is a number. `unknown` per key is exactly what
the runtime check proves, and it forces narrowing at the point of use — which a
foreign server makes necessary anyway.

### Cardinality: the OGC defaults are inverted

`minOccurs` and `maxOccurs` both default to `1`, so **an input with neither
field is required**. A parser written by someone thinking in JSON Schema — where
required-ness is a separate `required: []` array — makes every field optional,
the user submits an empty one, and the server's rejection is unexplainable
during a demo. The default is load-bearing: 1 541 of ZOO's 5 098 inputs omit
`minOccurs` and 4 947 omit `maxOccurs`.

`maxOccurs` is `number | "unbounded"`, a union with a _literal_. Every read must
handle both arms — `maxOccurs > 1` alone is a bug, because comparing a string to
a number silently yields `false` — so `required` and `multiple` are derived once
here rather than by each caller. `multiple` also decides the wire shape of the
execute request: above 1, the value is a JSON array rather than a bare value.

### Inputs and outputs are arrays, though the wire shape is an object

The server sends `"inputs": { "message": {…}, "bbox": {…} }`. The key is folded
in as `id` and you get an array back, because object key order is only
guaranteed for keys that do not look like integers — an input id of `"1"` would
silently jump to the front of your form — and because `.map()` wants an array.

`ProcessDescription extends ProcessSummary`, so a description goes anywhere a
summary does.

### Execution options carry their own honesty flag

```ts
interface ProcessExecutionOptions {
  sync: boolean;
  async: boolean;
  dismiss: boolean;
  declared: readonly string[]; // jobControlOptions verbatim
  defaulted: boolean; // true when the server said nothing and sync-only was assumed
}
```

`defaulted` separates "the server told us sync-only" from "the server said
nothing and the spec default is sync-only". The two look identical without it,
and they are different statements.

### Pagination is followed, with a ceiling

`listProcesses()` follows `rel="next"` and stops at whichever comes first: no
`next`, a `next` href already visited, 20 pages, or your abort signal — checked
_between_ pages, not only at the start. A server pointing `next` at itself is a
real bug in the wild and an unguarded loop hangs the tab.

When something other than the server stopped the walk, `truncated` is `true` and
`truncationReason` says which, so the UI can say "showing the first N" rather
than presenting a partial catalogue as the whole one. Ids are deduplicated
across pages, first occurrence winning.

### Tolerant, except about `id`

Fatal: the document is not an object, `processes` is not an array, or a process
has no string `id`. The error names the page and index — `page 1, entry at
index 3` — because it will be read by someone staring at an unfamiliar server's
output.

Everything else degrades and is recorded: a missing `version`, an absent
`jobControlOptions`, `keywords` sent as a bare string, an input with no schema.
A thrown error is a blank screen; a degraded field is one imperfect widget.

Members this layer does not model are kept nowhere, but **their names** reach
the observation — ZOO sends `mutable`, `metadata`, `extended-schema` and
`raw_schema1`; pygeoapi sends `example`. That is a cheap early-warning signal
for vendor extensions and v2 draft fields, without giving any caller a way to
reach around the typed API into the raw document.

A 404 on a description becomes `ProcessNotFoundError`, so the UI can say "no
such process on this service" rather than "HTTP 404".

### The schema-shape census

The `process-fetched` observation carries counts — and only counts — of how many
inputs use an inline `type`, an `enum`, a `$ref`, a composition keyword, a
`contentMediaType`, a `format`, or no schema at all. No ids, titles,
descriptions or values. It is the form-generation failure catalogue assembling
itself from real traffic instead of being reconstructed by hand later.

## Execution: `execute()`

```ts
const execution = await client.execute("hello-world", {
  inputs: { name: "world" },
  description: process, // optional: enables arity warnings and link-first routing
  mode: "sync", // the default; "async" sends Prefer: respond-async
  timeoutMs: 120_000, // the default; a sync calculation is still a calculation
});

if (execution.kind === "immediate") {
  execution.response.mediaType; // "application/json"
  execution.response.filename; // from Content-Disposition, when the server sent one
  const body = await execution.response.json();
} else {
  execution.job.statusUrl; // absolute, resolved against the response URL
  execution.job.jobId; // when the server named it
  execution.job.discoveredVia; // "location-header" | "body-link"
  execution.requestedMode; // "sync" — the server made a job anyway
}
```

`Execution` is a discriminated union, so `kind` narrows: inside the `immediate`
branch `response` is available and `job` is a compile error. Adding a third arm
later makes an incomplete `switch` fail to compile rather than fall through.

`requestedMode` is on **both** arms deliberately. It is what you asked for, while
`kind` is what happened, and when they disagree that is worth recording rather
than smoothing away.

### The result is an envelope, not a parsed body

A synchronous execution can answer with GeoJSON, a PNG, a zip, plain text, GML,
or a JSON document wrapping several of those. The correct parse depends on a
media type this package has no opinion about, so `execute()` returns the
`ResponseEnvelope` and leaves interpretation to the layer above. Everything a
renderer needs is already on it: `Content-Type`, the `Content-Disposition`
filename, `Content-Crs`, and a body readable more than once.

The only place the body is inspected is classification, and that read is gated on
the media type **and** wrapped in a `try` — because a server that returns XML
under `Content-Type: application/json` exists, and a client that trusts the label
throws on it. ZOO-Project's raw mode does exactly this.

### What happened is decided by the response, not by what you asked

The tempting implementation is `if (mode === "async") { …job… }`. It is wrong,
because the server decides: a server may create a job for a request that did not
ask for one, and may run something synchronously despite `Prefer: respond-async`,
since `Prefer` is a preference and not a command.

So classification reads the response:

1. status **201 or 202** → a job;
2. any other success whose JSON body is a job document — a `status` in the OGC
   job vocabulary, usually with `jobID` → a job;
3. otherwise → an immediate result.

A `Location` header is deliberately **not** step 1. pygeoapi 0.21 sends
`Location` on _every_ synchronous execution — and on its 400s — while the body
carries the finished result and the job it names is already `successful`.
Treating the header as the discriminator returns a job handle for every
synchronous run against that server, discards the answer the client is already
holding, and renders a status document where the result belongs. `Location` is
therefore a _route to_ a job already concluded to exist, not evidence that one
does.

### `Content-Type: application/json` on every request

Not merely because the specification says so. `fetch(url, { method: "POST", body:
someString })` sets `text/plain;charset=UTF-8` by itself, and one of the two
reference servers answers that with signal 11, SIGSEGV — a crash, not a 415. The
header is set explicitly on every execute request, and pinned by a unit test
rather than a live one, because the live version of that check takes down the
server it is run against.

`Accept` is an explicit `*/*`, which is not the same as omitting it: a browser
given no `Accept` supplies its own ranked list with `text/html` first and gets
back a web page. The wildcard overrides that without constraining what the server
may return.

### `outputs` and `response` are sent only when you supply them

Neither is synthesised from the process description. Choosing what a process
should emit is a presentation decision, and a helpfully-generated block asking
for `transmissionMode: "reference"` against a server declaring
`outputTransmission: ["value"]` is a self-inflicted failure.

One consequence worth knowing before you meet it: ZOO-Project rejects a body
carrying only `inputs`, with `400 InvalidParameterValue` and the text
`"cannot parse your POST data"`. Any `outputs` member — even `{}` — makes the
same request succeed. That is a defect in that server, and this package does not
paper over it with a per-server workaround, so **pass `outputs` explicitly if you
need to run against ZOO.**

### Arity is checked and never enforced

Pass `description` and each supplied input is compared against the cardinality
the server published — an array where `maxOccurs` is 1, a bare value where it is
greater, a missing required input, an input the description does not declare.
Each mismatch becomes a warning on the observation, and **the request is sent
anyway**.

Warning rather than blocking is the point. Neither reference server validates the
cardinality it publishes — one leaks a Python traceback, the other stringifies
the array into the result — and a client that refused to send could never have
established that. A missing required input may also just be a server default
about to apply.

### Two routes to a job, because one of them vanishes in a browser

`Location` is not a CORS-safelisted response header, so a cross-origin browser
request cannot read it unless the server also sends
`Access-Control-Expose-Headers: Location`. Neither reference server does. In Node
the header route works perfectly; in a browser, against the same server, it is
silently absent.

So a job is located by `Location` first, then by a `monitor` or `self` link in the
response body, and `discoveredVia` records which route was taken. If neither
exists, `AmbiguousExecutionResponseError` names the status, whether `Location` was
present, the media type and every body relation found — because a guess here
produces a job handle pointing nowhere, which fails later and somewhere else.

### Timeouts and aborts stay separable

`timeoutMs` and your `signal` can both cancel the request, and the resulting
error says which fired: `ExecutionTimeoutError` for the deadline, `AbortError`
for you. "The user cancelled" and "the server never answered" are different facts
about a service. Elapsed milliseconds are recorded on every execution, including
failures.

### Errors are outcomes

A refusal throws `ProcessesError` carrying whatever problem document the server
provided. No input-validation error is invented, because the status cannot tell
you whose fault it was: ZOO answers a rejected input with **500**, and an unknown
path with **400** rather than 404. Nothing here special-cases a status code, and
nothing retries — a failed execution is information, and retrying a
non-idempotent POST is how you get two jobs.

## Jobs: status, polling, results and dismissal

When a server creates a job, `execute()` hands back a `JobHandle` with a
`statusUrl`. These are the operations that make it useful. They are free
functions with thin client wrappers, deliberately **not** methods on the handle
— a handle with methods cannot be held in React state, serialised, or passed
through a reducer without dragging a live client behind it.

```ts
const status = await client.getJob(jobUrlOrId);
const report = await client.pollJob(jobUrlOrId, { onStatus, signal, timeoutMs });
const final = await client.waitForJob(jobUrlOrId);
const { envelope } = await client.getResults(jobUrlOrId, { status });
const outcome = await client.dismissJob(jobUrlOrId);
const { jobs } = await client.listJobs();
```

Each takes either an absolute status URL or a bare job id.

### A failed job is a return value, not an exception

This is the rule the whole layer is built around. A failed job is a perfectly
valid `200` whose document says `status: "failed"`, so `getJob()` classifies the
response rather than requiring it to be ok, and hands back a `JobStatus`:

```ts
const status = await client.getJob(url);
if (status.status === "failed") {
  console.error(status.message); // the server's own words
}
```

There is no `JobFailedError`. Throwing would discard the server's explanation
and replace it with a worse version of the same information, and the job panel's
entire purpose is to show what the server said. `waitForJob()` resolves for
`failed` and `dismissed` too; whether a failure is an error is the caller's
decision.

What _does_ throw: a 404 (`JobNotFoundError`), a 5xx (`ProcessesError`), a
transport failure, an abort, and a body with no usable `status`
(`MalformedJobDocumentError`).

### `running` is not a status you can wait for

pygeoapi 0.21.0 reports `status: "accepted"` for the **whole** of a job's
execution and goes straight to `successful`. It never reports `running`, and its
`progress` is a hardcoded `5` until the job finishes at `100`:

```
POST /processes/slow/execution   Prefer: respond-async
HTTP/1.1 201 CREATED

GET /jobs/{id}          → {"status":"accepted","progress":5,  …}   ← still working
GET /jobs/{id}          → {"status":"successful","progress":100, …}
```

ZOO, on the same sequence, reports `running` with real moving progress
(`"Step 40"`, `"Step 70"`). Two conformant-looking servers, opposite readings of
the same vocabulary.

So nothing here treats `running` as the signal that work has started. The only
distinction anything depends on is `terminal`, derived once on `JobStatus`:

```ts
if (!status.terminal) keepPolling();
```

An **unrecognised** status degrades rather than throwing: `rawStatus` keeps the
server's word verbatim, `statusRecognised` is `false`, a warning is recorded,
and the job is treated as non-terminal so the loop keeps going under its own
poll cap. A server inventing a status word should cost you a warning, not the
whole job.

### Polling is authoritative, and cancellable

Callbacks are doorbells; polling is truth. That ordering is deliberate and it
predates the relay on purpose — if a callback were ever the source of truth,
every missed, duplicated or reordered notification would become a job-state bug
that is impossible to reproduce.

```ts
const report = await client.pollJob(url, {
  onStatus: setStatus, // called once per poll, in order
  signal: controller.signal,
  timeoutMs: 600_000,
});
```

- **The abort signal is checked between polls**, not only at the start, so
  closing a job panel provably makes no further request.
- **`Retry-After` is honoured when sent**, in either wire format. `Retry-After: 0`
  means "ask again now" and is obeyed as such. Neither reference server sends
  the header at all, which is exactly why the backoff below has to be right.
- **Otherwise a bounded backoff**: 1 s, growing to a 10 s ceiling, with a 500 ms
  floor. A server-supplied value is capped at the ceiling but **not** raised to
  the floor — the floor exists to stop us hammering a server that has told us
  nothing, and a server sending `Retry-After: 0` has told us something.
- **The total deadline is separate from your signal**, and so is its error:
  `JobPollTimeoutError` for the deadline, `AbortError` for you. The timeout
  error carries the last status seen, the poll count and the elapsed time,
  because "still running after twenty minutes" and "never answered at all" are
  different failures.

`PollReport` carries the whole sequence — poll count, elapsed time, every status
in order, whether `Retry-After` was seen and honoured, and how it ended. That is
the evidence behind any claim about whether asynchronous execution is usable
against a given service.

`onStatus` is a callback rather than an async iterator because it composes with
React state without ceremony (`onStatus: setStatus` is the whole integration),
and an iterator's real advantage is backpressure, which a loop that sleeps
between polls has none to apply.

### Dismissal answers a question; it does not fail

```ts
const outcome = await client.dismissJob(url);
if (outcome.kind === "unsupported") {
  // 405 or 501 — this server cannot dismiss. Not an error.
}
```

A `405` is the answer the request asked for, so it is a return value. A `400`,
`403` or `500` is a genuine refusal and throws — "this server will not let you
dismiss _this_ job" and "this server cannot dismiss jobs at all" are different
statements.

**Nothing gates on `capabilities.dismiss`.** pygeoapi answers `DELETE` with a
`200` while declaring no dismiss conformance class at all. A client that checked
first would have hidden the button on a server that honours every cancellation,
and shipped "pygeoapi does not support dismiss", which is false. A conformance
class is evidence, not authorisation.

On **both** reference servers a successful dismissal **deletes** the job rather
than parking it at `status: "dismissed"`, so the next `GET` is a 404:

```
DELETE /jobs/{id}   → 200  {"status":"dismissed", …}
GET    /jobs/{id}   → 404
```

That means `JobNotFoundError` is the _normal_ end state of a cancelled job, not
an anomaly. `pollJob()` treats a 404 mid-poll as the ordinary ending it is and
reports `outcome: "dismissed-remotely"` rather than throwing.

### Results come back as an envelope

Same rule as `execute()`, for the same reason: a result may be GeoJSON, a PNG, a
zip, GML, or a JSON document wrapping several of those, and the correct parse
depends on a media type this layer has no opinion about.

```ts
const { envelope, route } = await client.getResults(url, { status });
envelope.mediaType; // "application/json", "image/png", …
envelope.filename; // from Content-Disposition
envelope.contentCrs; // OGC Content-Crs
```

`route` says whether the job document advertised the results (`"advertised-link"`)
or the path was rebuilt (`"constructed-path"`). Both reference servers advertise
the relation, and both write **only** the long OGC URI form.

**The `Accept` header is not `*/*`.** Against pygeoapi that returns a rendered
HTML page from the one endpoint whose entire purpose is to deliver the result:

```
GET /jobs/{id}/results   Accept: */*
HTTP/1.1 200 OK
Content-Type: text/html
```

So the request sends `application/json, */*;q=0.8` — a preference a
content-negotiating server can act on, while a result that is legitimately a PNG
or a zip is still acceptable and still arrives.

### A known gap: chunked result bodies are not size-guarded

`ResponseEnvelope` refuses to buffer a body whose **declared** `Content-Length`
exceeds `maxBufferBytes`. A chunked response declares no length, so it is
buffered regardless of size — and a result is exactly the response most likely
to be both large and chunked. ZOO's results endpoint sends
`Transfer-Encoding: chunked` on every response.

This is **tracked, not fixed**, against the October milestone. Fixing it properly
means streaming into a `Blob` with a running byte count, which changes the
envelope's reader contract for every caller, and doing that in the same change
as the job layer would couple two unrelated risks. Until then, pass an explicit
`maxBufferBytes` if you expect large results, and use `blob()` rather than
`text()` or `json()`.

### The job list, and why it is not a filter API

```ts
const { jobs, truncated } = await client.listJobs({ limit: 20 });
```

Follows `rel="next"` to a bounded depth, stopping on a cycle or the page cap and
setting `truncated` when it does. The two servers page differently — pygeoapi
builds `next` with `offset=`, ZOO with `skip=` — which costs nothing, because
the walk follows the advertised link rather than constructing one.

There are deliberately **no `processID` or `status` arguments**. ZOO honours both
query parameters; pygeoapi accepts them and silently ignores them, returning the
full list either way. A filter that is silently ignored is worse than no filter,
so the caller filters the returned array, which is correct everywhere.

One unreadable entry is skipped and counted rather than failing the page. That
matters more than it sounds: in a browser against pygeoapi, an asynchronous
execute throws `AmbiguousExecutionResponseError`, because `Location` is not
exposed cross-origin and the async `201` body is the literal `null`. The browser
has started a job it cannot name, and the job list is the only honest recovery —
show the user their recent jobs and let them recognise their own. **The client
never guesses**, because assuming the newest job is yours is wrong the moment two
people share a demo server.

### What a browser can and cannot do

Measured in a real browser, not inferred:

| Operation           | `:5080` (CORS) | `:5081` (no CORS) |
| ------------------- | -------------- | ----------------- |
| `GET /jobs/{id}`    | works          | blocked           |
| `DELETE /jobs/{id}` | **works**      | blocked           |
| read `Location`     | **blocked**    | blocked           |

`DELETE` is not a simple request, so it needs an `OPTIONS` preflight — a CORS
surface nothing before this touched. pygeoapi's `cors: true` answers it with
`Access-Control-Allow-Methods` including `DELETE`, so dismissal really is
reachable from a browser. `Location` is not, on either port, because neither
sends `Access-Control-Expose-Headers`.

That last row is the one that matters most. An asynchronous execute from a
browser against pygeoapi starts a job the page cannot name: `Location` is
filtered out, and the async `201` body is the literal `null`, so there is no
fallback. `execute()` raises `AmbiguousExecutionResponseError` rather than
guessing, and `listJobs()` is the honest recovery — show the user their recent
jobs and let them pick. Until a server sends
`Access-Control-Expose-Headers: Location`, asynchronous execution needs either
that recovery or the relay.

## Supported environments

- **ESM only.** No CommonJS build is published. There is no `main` field — a CJS
  consumer must use dynamic `import()`. If that turns out to matter, publishing
  CJS is a later decision, made with evidence behind it.
- **Node 18 or later.**
- **Modern browsers**, on an ES2022 baseline.
- **`fetch` is injected**, so any environment providing a WHATWG-compatible
  `fetch` works — workers, Deno, Bun, or a test double:

  ```ts
  createClient({ baseUrl, fetch: myFetch });
  ```

  Omit it and the ambient `globalThis.fetch` is used, which Node 18+ and
  browsers both provide.

The package contains no DOM-specific and no Node-specific API. That is enforced,
not promised — see below.

## How the runtime target is enforced

| Check                                                  | Catches                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `no-restricted-globals` on `src/**`                    | `window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `location`, `Buffer`, `process`, `__dirname`, `__filename` |
| `no-restricted-imports` on `src/**`                    | `node:*` and the bare built-ins (`fs`, `path`, `http`, `https`, `stream`, `buffer`, `url`, `crypto`)                            |
| `dependency-cruiser`                                   | a Node built-in reached _transitively_, through a dependency                                                                    |
| no `@types/node` in this package                       | `Buffer` and `node:` imports type-checking silently                                                                             |
| `no-restricted-globals` on `src/**` outside `src/http` | a `fetch` call bypassing the transport                                                                                          |
| Node consumer smoke test                               | DOM-only API in the published bundle                                                                                            |
| Browser bundle smoke test                              | Node-only import in the published bundle                                                                                        |
| `publint` + `attw` on the tarball                      | broken exports map, or types that resolve for us but not for a consumer                                                         |

The last three run against a packed tarball installed into a throwaway directory
outside the repo, not against the workspace source. Run them with
`pnpm test:smoke` from the repo root.

Part of the [oap-client](https://github.com/ITBreinstein/oap-client) monorepo. MIT.
