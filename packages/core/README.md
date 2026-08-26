# @breinstein/ogcapi-processes-core

A runtime-neutral [OGC API - Processes](https://ogcapi.ogc.org/processes/) client:
discovery, conformance, process listing, execution, job polling and results.

```bash
pnpm add @breinstein/ogcapi-processes-core
```

```ts
import { createClient, requireOk } from "@breinstein/ogcapi-processes-core";

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
