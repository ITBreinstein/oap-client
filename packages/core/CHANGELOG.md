# Changelog

Changes to `@breinstein/oap-client` that a consumer has to know about. Started
at 0.5.0; earlier versions are recorded only in the git history.

## Unreleased

### Breaking

- `readBodyLinks()` returns `readonly unknown[] | undefined`, not
  `readonly Link[] | undefined`. It never checked its entries: an entry with no
  `rel`, or `null`, reached `findLink()` typed as a `Link`, and `findLink()`
  threw. Hand its result to `collectLinks()` or `resolveBodyLinks()`, which
  check each entry and resolve its href, and look links up in what they return.
  Their `bodyLinks` parameter is widened to `readonly unknown[] | undefined` to
  match, which breaks no caller. Code that passed `readBodyLinks()` straight to
  `findLink()` or `findLinks()` stops compiling, and was the code that crashed.
- `isJobState()` is case-sensitive: it accepts only the vocabulary as spelled,
  `"successful"` and not `"Successful"`. It accepted any case and narrowed the
  string to the lowercase `JobState` it did not hold. To read a status a server
  sent, in whatever case, use the new `toJobState()`. The core's own parsing
  does, so `getJob()`, `pollJob()` and the execution classifier read a
  capitalised status as before.

### Fixed

- `ResponseEnvelope.location` is undefined when the `Location` header is empty
  or cannot be resolved; `locationRaw` still holds what was sent. An empty one
  resolved to the response's own URL, so an async `execute()` returned a job
  whose `statusUrl` was the execute endpoint. One that could not be resolved
  was kept as it was, so `statusUrl` was not an absolute URL, as `JobHandle`
  documents it is. `execute()` now treats either as no `Location`: the job is
  found by its body's `monitor` or `self` link, or `AmbiguousExecutionResponseError`
  is thrown with `locationPresent: true`.

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

- `timeoutMs: Infinity` now means no deadline, for `execute()`, `pollJob()`,
  `waitForJob()` and the client's methods. It used to fail at once, since a
  timer fires a delay it cannot hold after about 1 ms. A finite `timeoutMs`
  longer than a timer holds (2 147 483 647 ms, a little under 25 days) is held
  to that, instead of firing at once too.

- `waitForJob` throws `JobNotFoundError` when the job went away while it was
  being polled (`pollJob`'s `dismissed-remotely`). It used to return the last
  status it had seen, `running` for example, although it promises a final one.
- `pollJob` treats a 429 or 503 that carries a usable `Retry-After` as "ask
  again then": it waits as the header asks, within its usual bounds and its
  deadline, and polls again. The code goes into `statusSequence` in place of a
  status. It used to end the loop with a `ProcessesError`. Without such a
  header, those statuses are still errors.
- `Retry-After` is read as a date only in the three HTTP-date forms RFC 9110
  defines (IMF-fixdate, the obsolete RFC 850 form, and asctime, read as GMT).
  `Date.parse` used to be asked about anything that did not start with a digit,
  so `"wait 10"` became a date in 2001 (0 ms) and `"later 2027"` one months
  away. Anything else is now ignored, so `retryAfterMs` is `undefined`.

- A response declared `application/problem+json` is a problem document even
  without `type` or `title`: as RFC 9457 says, a missing (or non-string) `type`
  is `about:blank`. Such a body served at 200, say
  `{"detail":"backend unavailable","status":503}`, was classified `ok`, and
  `execute()` handed it over as the result. It is now an `exception`. A body
  not declared as a problem document is judged as before.

### Added

- `toJobState(value)`: the OGC job status a string names, in any case, as the
  vocabulary spells it (`"Successful"` → `"successful"`), or `undefined`.
- `AmbiguousExecutionResponseError.jobId`: the job id the body named (`jobID`,
  or `id`), when it named one. A spec-minimal `{"jobID", "status"}` with
  `Location` hidden cross-origin is all a browser sees (finding 0039), and the id
  used to be discarded. `client.getJob()` accepts it as a bare id. The
  constructor takes it as an optional sixth argument.
- `EnvelopeOptions.signal`: the signal the request was sent with. A body read
  it cuts short rejects with `AbortError`, whatever the runtime errored the
  stream with. `send()` passes its own; set it when you call `createEnvelope`
  yourself.
- The `execution` observation's `crossOrigin`: for a request that never
  produced a response, whether it left the page's origin, taken from
  `TransportError.crossOrigin`. A cross-origin one may have been refused at its
  CORS preflight, which a page cannot tell from a network failure; a same-origin
  one cannot have been. `undefined` off-browser and whenever a response
  arrived. A new required member of the observation type: code that builds
  `execution` observations itself has to set it.

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
