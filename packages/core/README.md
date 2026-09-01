# @breinstein/oap-client

A runtime-neutral [OGC API - Processes](https://ogcapi.ogc.org/processes/) client:
discovery, conformance, process listing, execution, job polling and results.

```bash
pnpm add @breinstein/oap-client
```

```ts
import { createClient, requireOk } from "@breinstein/oap-client";

const client = createClient({ baseUrl: "https://example.org/ogc" });
const response = await requireOk(await client.send("processes"));
const processes = await response.json();
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

Part of the [oap-client](https://github.com/breinstein/breinstein-oap-client) monorepo. MIT.
