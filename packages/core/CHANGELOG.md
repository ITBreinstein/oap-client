# Changelog

Changes to `@breinstein/oap-client` that a consumer has to know about. Started
at 0.5.0; earlier versions are recorded only in the git history.

## Unreleased

### Fixed

- `createClient` adds the trailing slash a base URL needs to its _path_. It used
  to append it to the whole string, so a base with a query got the slash on the
  query: `https://host/ogc?apikey=abc` became `…/ogc?apikey=abc/`, `client.baseUrl`
  carried that, and every URL resolved from it lost the `ogc` segment. A landing
  page address copied with `?f=json` became `?f=json/`, which pygeoapi answers
  with 400. `client.baseUrl` is now `https://host/ogc/?apikey=abc`, and the
  landing page is requested with the query intact.
- `execute()`: `timeoutMs` and `signal` now also cover reading the body, as far
  as classifying the answer reads it (the problem check and the evidence).
  They were released when the headers arrived, so a server that sent its
  headers and then stalled hung `execute()` for ever. Such a stall now ends in
  `ExecutionTimeoutError`, a cancel in `AbortError`, and the `execution`
  observation records `transport-failure` with the status that did arrive. A
  body `execute()` does not read itself, such as a non-JSON result, is read by
  the caller after it returns, as before.
- An abort, a deadline or the buffer limit hit while a body is still arriving
  is no longer reported as a malformed document. `fetchJson`, `listProcesses`,
  `getProcess`, `listJobs`, `getJob` and `pollJob` now reject with
  `AbortError`, with `BodyTooLargeError`, or, when `pollJob`'s own deadline
  fires, with `JobPollTimeoutError` and `outcome: "timeout"`. Before, they
  rejected with `MalformedDocumentError` or `MalformedJobDocumentError`.
  `inspect()` rejects with `AbortError` where it resolved with every capability
  unknown. Only a body that arrived whole and is not JSON is malformed now.
- `classify()` lets such an abort through, rather than reading it as "no
  problem document".
- The client's job methods given a bare job id (`getJob`, `pollJob`,
  `waitForJob`, `getResults`, `dismissJob`), and `listJobs`, now honour the
  caller's `signal` while the client discovers the job-list URL. With a landing
  page that never answered, they waited for ever whatever the caller did.
  `execute`'s `timeoutMs`, and `pollJob`'s and `waitForJob`'s for a bare id,
  now count that discovery too. Running out there throws
  `ExecutionTimeoutError` or `JobPollTimeoutError`, whose `url` is then the
  landing page, since no job URL is known yet; what is left of the deadline goes
  to the call.
- The client's shared discovery gives up on a landing page after 30 seconds,
  falls back to the constructed path as it does for one it cannot reach, and
  asks again on the next call. It used to wait for ever, and every later call
  on that client waited with it.

### Added

- `EnvelopeOptions.signal`: the signal the request was sent with. A body read
  it cuts short rejects with `AbortError`, whatever the runtime errored the
  stream with. `send()` passes its own; set it when you call `createEnvelope`
  yourself.

## 0.5.0

### Breaking

- `KnownRelation` gains `"items"`, the OGC API - Features relation from a
  collection to its features, matched in its short form and as
  `http://www.opengis.net/def/rel/ogc/1.0/items`. Code that switches over every
  member of `KnownRelation` with an exhaustiveness check (`satisfies never`, or
  a `default` that assigns to `never`) stops compiling until it handles
  `"items"`. Nothing else about relation matching changes.

- A body that declares no `Content-Length` (chunked), or declares less than it
  sends, is now counted as it is read and refused at `maxBufferBytes`. Reading
  stops and the stream is cancelled; `json()`, `text()`, `arrayBuffer()` and
  `blob()` all reject with `BodyTooLargeError`. Before, such a body was buffered
  whole, whatever its size. A chunked result over the limit that used to
  arrive now fails: raise `maxBufferBytes` to read it. A declared length over
  the limit behaves as before: refused up front, `blob()` still streams it.
- `BodyTooLargeError.contentLength` is now `number | undefined`: undefined when
  the server declared no length. It gains `bytesRead`, the decoded bytes read
  when counting stopped, undefined when the declared length was refused.

### Added

- `resolveHref(href, base)`: resolves one href against the URL its document was
  served from, returning `undefined` when it cannot be made absolute. For an
  href outside a `links` array, such as an output given by reference in a
  results document, which may carry no `rel`. `resolveBodyLinks` is unchanged
  and still skips an entry without one.
