# @breinstein/relay

A small Hono service that does two things a browser cannot do against the
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

It is **not a proxy**. It forwards no reads, no results and no dismissals. A
server that sends no CORS headers at all — pygeoapi on `:5081`, ZOO — stays
unusable from a browser with the relay running (findings 0049 and 0050).
And the client works without it: every job is still found by polling.

## Running it

```bash
pnpm --filter @breinstein/relay build
RELAY_CONFIG=../../infra/relay/ci.json pnpm --filter @breinstein/relay start   # :8787

docker build -f apps/relay/Dockerfile -t oap-relay .                           # from the repo root
```

Configuration is one JSON file; see [infra/relay/](../../infra/relay/) for the
CI config and a public-demo template, and `src/config.ts` for every field.

## The two per-endpoint decisions

Both are made in the config, before any request exists.

- **`executeRoute`** — `direct` or `relay`. Chosen per endpoint and never by
  trying one route and falling back to the other: execute is not idempotent,
  and a direct attempt the browser could not read has already created a job.
  Only asynchronous executes take the relay route; a synchronous result is the
  response body, which a browser can read wherever the server allows CORS.
- **`callbacks`** — off unless set. Against pygeoapi 0.21.0, a callback the
  server cannot deliver stalls the job in `accepted` or rewrites a
  `successful` one to `failed` (finding 0047), so with callbacks on, the
  relay's _availability_ becomes part of every job's correctness. Off for the
  public demo; on for pygeoapi in CI.

## HTTP API

| Route                                     | Caller     | Answers                                                                                                   |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                            | operator   | `{ "ok": true }`                                                                                          |
| `GET /endpoints`                          | browser    | each endpoint's `key`, `baseUrl`, `executeRoute`, `callbacks`                                             |
| `POST /sessions`                          | browser    | `201 { token, expiresAt }` — the session token                                                            |
| `GET /sessions/events`                    | browser    | `text/event-stream`: `ready`, then `job` events `{ "ref" }`                                               |
| `POST /execute/{endpointKey}/{processId}` | browser    | `{ upstream: { status, location, contentType, preferenceApplied, body }, registration: { ref } \| null }` |
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

### Outbound: the execute request

The only request the relay sends, and everything about it is fixed:

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
  expire after an idle hour, but a session with an open stream never idles, so
  someone holding many streams open can use up the cap. Executes are only as
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
