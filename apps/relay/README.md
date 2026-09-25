# @breinstein/relay

A small Hono service that does three things a browser cannot do against the
reference OGC API - Processes servers, and nothing else.

1. **Names the job a browser just started.** Cross-origin, a browser cannot
   read `Location` unless the server sends
   `Access-Control-Expose-Headers: Location`, and pygeoapi's asynchronous `201`
   body is `null` — so the job starts and the page cannot find it (finding
   0039). For endpoints configured for it, the relay sends that one execute
   request on the browser's behalf and hands back `Location`.
2. **Rings a doorbell when a job changes.** It receives the OGC server's
   `subscriber` callbacks and tells the browser "something happened to job X"
   over a server-sent event stream. Never _what_ happened: the browser reads
   the job's status from the server itself.

3. **Reads a server that sends no CORS headers**, for endpoints configured
   with `readRoute: "relay"` only. ZOO sends none at all, so a web page cannot
   read even its landing page (finding 0050). For such an endpoint the relay
   forwards `GET` under its `baseUrl`, `DELETE` on one job, and synchronous
   executes, and hands back the server's answer with the headers the core
   reads as evidence.

It is **not a general proxy**. It never takes a URL from the browser, only a
path relative to a configured endpoint's `baseUrl`, and it forwards reads only
for endpoints configured with `readRoute: "relay"`. The web app never sends
one unprompted: it always tries the server directly first, and offers the read
route only after a CORS failure, and only once the user has confirmed it. The
direct failure is still recorded. So the matrix still says the server cannot
be used from a web page, and the page shows it is reaching the server through
the relay. This is phase 3 of the plan: a proxy added only after a server had
been shown to need one (finding 0050), not a change of course. Without
`readRoute`, a server with no CORS headers — pygeoapi on `:5081` in CI —
stays unusable from a browser, relay or not (finding 0049).

The client works without the relay: every job is still found by polling.

One more per-endpoint setting is not a decision about routes at all:
`processes`, an optional list of process ids, narrows what the web app _lists_
for that endpoint. It exists for a deployment that carries far more than the
demo needs. `zoo` in `infra/relay/ci.json` lists only the 46 processes whose definitions
are in the Gouwe-Gozer fork's own repository (its `zoo-project/zoo-services`,
including the two its compose file mounts as `org.n52.javaps.test.*`), out of 703. The rest, SAGA and OTB among them, come with the upstream base image. It is not
access control: the relay forwards nothing on the strength of it, and the
page still reads the whole list, records its size, and says how many it
left out.

## Running it

```bash
pnpm --filter @breinstein/relay build
RELAY_CONFIG=../../infra/relay/ci.json pnpm --filter @breinstein/relay start   # :8787

docker build -f apps/relay/Dockerfile -t oap-relay .                           # from the repo root
```

Configuration is one JSON file; see [infra/relay/](../../infra/relay/) for the
CI config and a public-demo template, and `src/config.ts` for every field.

## The three per-endpoint decisions

All three are made in the config, before any request exists.

- **`executeRoute`** — `direct` or `relay`. Chosen per endpoint and never by
  trying one route and falling back to the other: execute is not idempotent,
  and a direct attempt the browser could not read has already created a job.
  Only asynchronous executes take the relay route, unless the endpoint also has
  `readRoute: "relay"`: a synchronous result is the response body, which a
  browser can read wherever the server allows CORS, and cannot anywhere else.
- **`readRoute`** — `direct` (default) or `relay`. With `relay`, the read route
  below is open for this endpoint, and synchronous executes are forwarded raw.
  Requires `executeRoute: "relay"`: a browser that cannot read the server
  cannot read an execute's answer either. It is a permission, not a switch:
  the web app still goes direct first and asks the user before using it.
- **`callbacks`** — off unless set. Against pygeoapi 0.21.0, a callback the
  server cannot deliver stalls the job in `accepted` or rewrites a
  `successful` one to `failed` (finding 0047), so with callbacks on, the
  relay's _availability_ becomes part of every job's correctness. Off for the
  public demo; on for pygeoapi in CI.

## HTTP API

| Route                                     | Caller     | Answers                                                                                                   |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                            | operator   | `{ "ok": true }`                                                                                          |
| `GET /endpoints`                          | browser    | each endpoint's `key`, `baseUrl`, `executeRoute`, `readRoute`, `callbacks`, and `processes` when set      |
| `POST /sessions`                          | browser    | `201 { token, expiresAt }` — the session token                                                            |
| `GET /sessions/events`                    | browser    | `text/event-stream`: `ready`, then `job` events `{ "ref" }`                                               |
| `POST /execute/{endpointKey}/{processId}` | browser    | `{ upstream: { status, location, contentType, preferenceApplied, body }, registration: { ref } \| null }` |
|                                           |            | — or, for a `readRoute: "relay"` endpoint and no `Prefer: respond-async`: the server's answer, raw        |
| `GET /read/{endpointKey}/{path*}`         | browser    | the server's answer to `GET {baseUrl}/{path}?{query}`, raw; session token required                        |
| `DELETE /read/{endpointKey}/jobs/{id}`    | browser    | the server's answer to dismissing that job, raw; session token required                                   |
| `POST /callbacks/{token}/{kind}`          | OGC server | `200`, or `404` for a token it does not know                                                              |

The browser side of this contract lives in
[`apps/web/src/relay/`](../web/src/relay/), not in `packages/core`: the
published core knows nothing about this relay.

### Tokens

Three kinds, so that knowing one grants nothing the others protect:

- **session token** — 256 bits. Reads one browser's event stream. Sent only as
  `Authorization: Bearer`, never in a URL.
- **callback token** — 256 bits, one per job. Embedded in the subscriber URLs,
  and assumed public: pygeoapi logs those URLs, and writes one into a job's
  `message` when delivery fails (finding 0047). Its only power is to ring one
  job's doorbell, which makes the browser poll sooner.
- **ref** — 96 bits, not secret. Names a registration to the browser.

All from the platform CSPRNG. Sessions expire after an idle hour without an
open stream; registrations after 24 hours. State is in memory and swept every
minute. Losing it — a restart — costs doorbells, never jobs; see below.

### Callback receivers

Token checked first, from the path; the body is **never read** — not parsed,
not buffered, not trusted for a job id or a state. The answer is empty. An
unknown or expired token is answered `404`, never refused at the socket:
pygeoapi ignores a callback's response status but treats a refused
connection as a failure of the job (finding 0047). That is also why the relay
must stay reachable while callbacks are on — a restart window is a window in
which pygeoapi jobs can be damaged. The relay-restart contract test asserts the
job's status on the server, not only in the browser.

### Markers: whose answer is this?

Every response the relay sends carries `X-Relay: 1`. Every response it
generates itself, rather than forwards, also carries `X-Relay-Error: <code>`:
its refusals (`unknown-endpoint`, `read-route-off`, `unknown-session`,
`absolute-url`, `dot-segment`, `encoded-separator`, `delete-not-a-job`, …) and
its own `502`s (`timeout`, `connection-failed`, `blocked-address`,
`response-too-large`, `redirect-limit`, `redirect-refused`). Both are exposed
to the page.

The web app reads them in that order. A response without `X-Relay` never came
from the relay: a reverse proxy in front of it answers `502` or `504` by itself
when the relay is down. A response with `X-Relay-Error` is the relay speaking,
not the OGC server. Only a response with `X-Relay` and without `X-Relay-Error`
is the server's own answer — its `404` and `500` included — and only that
reaches the core.

### Outbound: the read route

For `readRoute: "relay"` endpoints only, with a live session:

- **URL:** the endpoint's `baseUrl`, plus the path the browser sent relative to
  it, plus the query string verbatim. Absolute URLs, `.` and `..` segments
  (any spelling), and encoded `/` or `\` are refused, and the result must still
  be under `baseUrl` after normalisation.
- **Methods:** `GET`; `DELETE` only on `{baseUrl}/jobs/{id}`; and the
  synchronous execute `POST`, built by `/execute`, which then also needs a
  live session.
- **Headers out:** `Accept`, `Accept-Language`, `Prefer`, `Content-Type` from the
  browser, and the relay's own `User-Agent`. Nothing else: no cookie, no
  authorization, no origin.
- **Headers back:** `Content-Type`, `Content-Length`, `Content-Crs`,
  `Content-Disposition`, `Location`, `Retry-After`, `Link`,
  `Preference-Applied`, unchanged, and none other. Nothing inside a body is
  rewritten; absolute links under `baseUrl` stay as they are, and the web app
  maps them back onto this route.
- **Redirects:** followed by hand for `GET` only, while the target is still
  under `baseUrl`, at most three times. Any other redirect is the relay's own
  `502 redirect-refused`, never handed back: a browser `fetch` cannot take a
  3xx without following it, and the page would then blame the relay for what
  the server did.
- **Address:** every hop goes through the address check below, on a fresh
  connection.
- **Size and time:** the body is streamed, not buffered, up to
  `limits.maxReadResponseBytes` (50 MB) and within `limits.readTimeoutMs`
  (120 s) for the whole exchange. A cap hit before the status line is a `502`
  naming it. A cap hit while the body is streaming cannot change the status any
  more, so the stream is broken off, and the browser sees a failed read rather
  than a short body passed off as whole.
- **Audit:** one JSON line on stdout per forwarded request —
  `{ audit, endpointKey, method, path, queryNames, upstreamStatus, failure,
redirectsFollowed, bytes, ms, capHit }`. The path is relative to the base,
  and only the query's parameter _names_ are kept. Never a value, a body, a
  token or a header.

### Outbound: the execute request

The asynchronous execute. Everything about it is fixed:

- `POST`, to `{baseUrl}/processes/{processId}/execution`, the base from the
  allowlist and the id restricted to `[A-Za-z0-9._~-]`.
- `Content-Type: application/json`, `Accept: */*`, `Prefer: respond-async`.
  No browser header or cookie is forwarded.
- A browser-supplied `subscriber` is refused; the relay mints its own.
- No redirect is followed, so no hop goes unvalidated.
- One deadline for the whole exchange, and a cap on the response body.
- Every address the endpoint's name resolves to is checked at connect time,
  and loopback, private, link-local, reserved, NAT64, 6to4 and cloud-metadata
  ranges are refused — unless the endpoint sets `allowPrivateNetwork`, which
  only local and CI configs do. The check is adapted from GeoLibre's proxy
  guard (THIRD_PARTY.md).

## Not yet done — before the public demo

Known gaps, not hidden:

- **No rate limiting.** Anyone can create sessions and send executes through
  the relay; CORS only restrains browsers. Sessions are capped (10 000) and
  expire after an idle hour. At the cap, a new session takes the place of the
  least recently used one without an open stream, so creating sessions alone
  cannot lock pages out; but a session with an open stream is never evicted,
  so someone holding many streams open can still use up the cap. Executes are only as
  limited as the allowlisted servers are. Put the relay behind a reverse proxy
  with per-client limits on `POST /sessions`, `GET /sessions/events` and
  `POST /execute`, or add them here, before it faces the internet.
- **No limit on streams per session.** Harmless to correctness, but part of the
  point above.

## Tests

```bash
pnpm vitest run --project relay                                  # unit: no network, no sleeps
pnpm vitest run --config apps/relay/vitest.contract.config.ts    # live pygeoapi, real callbacks
```
