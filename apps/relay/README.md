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
   `subscriber` callbacks and tells the browser "the server called job X's
   success URI" (or in-progress, or failed) over a server-sent event stream.
   Never anything the server sent with the call: the browser reads the job's
   status from the server itself. Which URI was called tells the browser only
   that a success callback was delivered, so the server has no reason to
   rewrite a `successful` job as `failed` (finding 0047).

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
been shown to need one (finding 0050), not a change of course. The decision,
and the alternatives rejected, are in
[docs/adr/0001-relay-read-route.md](../../docs/adr/0001-relay-read-route.md). Without
`readRoute`, a server with no CORS headers — pygeoapi on `:5081` in CI —
stays unusable from a browser, relay or not (finding 0049).

The client works without the relay: every job is still found by polling.

## Running it

```bash
pnpm --filter @breinstein/relay build
RELAY_CONFIG=../../infra/relay/ci.json RELAY_ALLOW_PRIVATE_ADDRESSES=1 \
  pnpm --filter @breinstein/relay start                                        # :8787
RELAY_CONFIG=../../infra/relay/ci.json RELAY_ALLOW_PRIVATE_ADDRESSES=1 \
  pnpm --filter @breinstein/relay dev                                          # :8787, rebuilt and restarted on change

docker build -f apps/relay/Dockerfile -t oap-relay .                           # from the repo root
```

Configuration is one JSON file; see [infra/relay/](../../infra/relay/) for the
CI config and a public-demo template, and `src/config.ts` for every field. The
two deadlines, `limits.readTimeoutMs` and `limits.upstreamTimeoutMs`, may be at
most 2 147 483 647 ms (about 24.8 days), the longest timer Node holds; a longer
one would fire at once, so the relay refuses to start with it.

`RELAY_BUILD_ID`, when set, is reported on `/healthz` as `build`. The browser
test lane sets it to a hash of what it built the relay from, and refuses to run
against a relay on its port that reports anything else
([e2e/global-setup.ts](../../e2e/global-setup.ts)).

### Private addresses take two keys

An endpoint on plain `http:`, or on a loopback, private or otherwise reserved
host, starts only when both keys are turned:

- the endpoint sets `allowPrivateNetwork`, which switches the address check
  off for that endpoint; and
- the process runs with `RELAY_ALLOW_PRIVATE_ADDRESSES=1`.

Neither does anything alone. Without both, the relay refuses to start and names
the field. With both, it prints a warning naming every endpoint whose check is
off. `ci.json` needs both, and Playwright sets the variable. A public
deployment sets neither: copy `ci.json` into it and the relay will not start,
rather than run with the check off. Any other value than `1`, `0` or unset is
refused as a typo.

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

  **Turn callbacks on only for an endpoint where the relay's uptime is
  guaranteed for as long as that server's jobs run.** A callback is sent from
  the OGC server to the relay, so while the relay is down — a restart, a
  redeploy, a crash — the server's connection is refused. Measured again on
  2026-09-30 against pygeoapi 0.21.0: a job whose callbacks all pointed at a
  relay that was down stayed `accepted` and never ran; a job whose relay went
  down before it finished was reported `successful` and rewritten to `failed`
  0.2 s later. Polling cannot repair either: it reads the damaged status,
  which is then the server's truth. Nothing the browser can check tells it the
  relay will still be up when the job ends, so this is a deployment decision,
  made here in the config.

  The web app narrows the window it can see: it sends the relay a session —
  the thing that makes the relay add a `subscriber` — only while its doorbell
  stream is open, and otherwise starts the job for polling only
  (`sessionWithheld` on the `execute-route` observation). And for a job it
  started with callbacks, it keeps reading a first `successful`, less often
  each time, until the doorbell says the success callback arrived or three
  minutes have passed, marks the result "not yet confirmed" meanwhile, and
  shows both statuses if they differ. A receiver that hangs rather than
  refuses makes the server wait for its connection attempt to time out,
  about two minutes, before it rewrites the job (review W14).

## HTTP API

| Route                                     | Caller     | Answers                                                                                                                          |
| ----------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                            | operator   | `{ "ok": true }`, and `"build"` when the process was started with `RELAY_BUILD_ID`                                               |
| `GET /endpoints`                          | browser    | each endpoint's `key`, `baseUrl`, `executeRoute`, `readRoute`, `callbacks`                                                       |
| `POST /sessions`                          | browser    | `201 { token, expiresAt }` — the session token                                                                                   |
| `GET /sessions/events`                    | browser    | `text/event-stream`: `ready`, then `job` events `{ "ref", "callbacks" }`: the callbacks called since the last event for that job |
| `POST /execute/{endpointKey}/{processId}` | browser    | `{ upstream: { status, location, contentType, preferenceApplied, body }, registration: { ref } \| null }`                        |
|                                           |            | when the server created a job (`201`/`202`); otherwise the server's answer, raw, with `X-Relay-Raw: 1`                           |
|                                           |            | — and always raw for a `readRoute: "relay"` endpoint and no `Prefer: respond-async`                                              |
| `GET /read/{endpointKey}/{path*}`         | browser    | the server's answer to `GET {baseUrl}/{path}?{query}`, raw; session token required                                               |
| `DELETE /read/{endpointKey}/jobs/{id}`    | browser    | the server's answer to dismissing that job, raw; session token required                                                          |
| `POST /callbacks/{token}/{kind}`          | OGC server | `200`, or `404` for a token it does not know                                                                                     |

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
open stream, and after 24 hours whatever they hold (`sessionMaxAgeMs`), which
closes their streams; registrations after 24 hours. A session holds at most
four event streams (`limits.maxStreamsPerSession`); a fifth closes the oldest.
The relay holds at most 1 000 in all (`limits.maxOpenStreams`); one more is
refused with `503`, `X-Relay-Error: stream-capacity`, and the page carries on
polling. State is in memory and swept every minute. Losing it — a restart —
costs doorbells, never jobs; see below.

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
`response-too-large`, `redirect-limit`, and `bad-upstream-status` for a status
line outside 200–599, which no browser can be handed). Both are exposed to the
page. The one
exception is the callback route's `404`, which no page ever sees: only OGC
servers call that route, and pygeoapi ignores the status anyway (finding 0047).

The web app reads them in that order. A response without `X-Relay` never came
from the relay: a reverse proxy in front of it answers `502` or `504` by itself
when the relay is down. A response with `X-Relay-Error` is the relay speaking,
not the OGC server. Only a response with `X-Relay` and without `X-Relay-Error`
is the server's own answer — its `404` and `500` included — and only that
reaches the core.

`/execute` adds a third marker, `X-Relay-Raw: 1`, also exposed, on an answer
that is the server's own response rather than the relay's envelope. The web
app checks it before the status: a raw answer's status is the server's, and a
synchronous result is a `200` like the envelope.

### Outbound: the read route

For `readRoute: "relay"` endpoints only, with a live session:

- **URL:** the endpoint's `baseUrl`, plus the path the browser sent relative to
  it, plus the query string verbatim. Absolute URLs, `.` and `..` segments
  (any spelling), and encoded `/` or `\` are refused, and the result must still
  be under `baseUrl` after normalisation.
- **Methods:** `GET`; `DELETE` only on `{baseUrl}/jobs/{id}`; and the
  synchronous execute `POST`, built by `/execute`.
- **Headers out:** `Accept`, `Accept-Language`, `Prefer`, `Content-Type` from the
  browser, and the relay's own `User-Agent`. Nothing else: no cookie, no
  authorization, no origin.
- **Headers back:** `Content-Type`, `Content-Length`, `Content-Crs`,
  `Content-Disposition`, `Location`, `Retry-After`, `Link`,
  `Preference-Applied`, unchanged, and none other. Nothing inside a body is
  rewritten; absolute links under `baseUrl` stay as they are, and the web app
  maps them back onto this route.
- **Redirects:** followed by hand for `GET` only, while the target is still
  under `baseUrl` (same origin, no userinfo), at most three times. Any other redirect is handed back as the
  server sent it. A redirect that is followed is dropped with its body unread.
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
  allowlist. The id is one of `[A-Za-z0-9_]` followed by at most 127 of
  `[A-Za-z0-9._~:-]`, so `ns:process:v1` passes and a leading `.` or `:` does
  not, and it is percent-encoded into its own path segment.
- `Content-Type: application/json`, `Accept: */*`, `Prefer: respond-async`.
  No browser header or cookie is forwarded.
- A browser-supplied `subscriber` is refused; the relay mints its own.
- No redirect is followed, so no hop goes unvalidated.
- **The answer:** a `201` or `202` names a job. Its body is read whole, up to
  `limits.maxUpstreamResponseBytes` (256 KiB), and handed back in the envelope
  with `Location`. Any other answer is not a job: the result itself, from a
  server that ran the process synchronously anyway — pygeoapi does for a
  process that declares `sync-execute` only (finding 0059) — or a refusal. It
  is passed on as the read route passes one on: the evidence headers only, the
  body streamed and unchanged, up to `limits.maxReadResponseBytes` (50 MB),
  marked `X-Relay-Raw: 1`. Any registration made for it is dropped, since
  there is no job to ring for.
- One deadline for the whole exchange, `limits.upstreamTimeoutMs` (120 s), a
  raw body still streaming included. As long as the read route's, because a
  server that runs the process synchronously answers only when it has
  finished.
- **Audit:** an exchange that produces no response — refused by the address
  check, timed out, failed to connect — and one answered raw write the read
  route's audit line, with `"audit": "execute"` and
  `path: "/processes/{id}/execution"`. A job writes none.
- Every address the endpoint's name resolves to is checked at connect time,
  and loopback, private, link-local, reserved, NAT64, 6to4 and cloud-metadata
  ranges are refused — unless the endpoint sets `allowPrivateNetwork`, which
  only local and CI configs do, and which needs `RELAY_ALLOW_PRIVATE_ADDRESSES=1`
  (above). The check is adapted from GeoLibre's proxy
  guard (THIRD_PARTY.md).

## Not yet done — before the public demo

Known gaps, not hidden:

- **No rate limiting.** Anyone can create sessions and send executes through
  the relay; CORS only restrains browsers. Sessions (10 000) and streams
  (1 000) are capped and no session outlives 24 hours, but one client can
  still take every place until then. Executes are only as limited as the
  allowlisted servers are. Put the relay behind a reverse proxy with
  per-client limits on `POST /sessions`, `GET /sessions/events` and
  `POST /execute`, or add them here, before it faces the internet.

## Tests

```bash
pnpm vitest run --project relay                                  # unit: no network, no sleeps
pnpm vitest run --config apps/relay/vitest.contract.config.ts    # live pygeoapi, real callbacks
```
