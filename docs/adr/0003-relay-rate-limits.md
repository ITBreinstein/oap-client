# 3. Rate limits in the relay, keyed by a client address it can trust

- **Status:** accepted
- **Date:** 2026-10-14
- **Where:** `apps/relay` (the limits and the client address), `apps/web`
  (what the page says), `deploy/` (the network and the one trusted proxy).
  `packages/core` is unchanged.

## Context

ADR 0001 gave the relay a read route and left one gap open: the relay had no
rate limiting, and must not face the internet without it. Nothing it serves
can tell a person from a script:

- `POST /sessions` needs no credentials, so a session token proves only that
  someone asked for one.
- `allowedOrigins` restrains browsers. `curl` ignores it.

So anyone could send unlimited reads and executes to every configured server,
from the relay's address. The SSRF guard decides _where_ the relay may send;
nothing decided _how much_.

The relay is to run as a container beside the static site, behind the
host's Caddy, at `/api` on the same origin.

## Decision

### The limits live in the relay

Per client, per minute: 10 sessions, 20 executes, 240 reads, and 120 endpoint
listings and CORS preflights together. Per client, at once: 4 event streams,
and 6 executes and reads in flight. Per configured endpoint, across all
clients: 600 executes and reads a minute, and 32 in flight. All are in a
`rateLimits` member of the relay's config; the defaults are the production
values, and there is no switch that turns them off.

A refusal is the relay's own `429`, like its other refusals: problem+json,
`Cache-Control: no-store`, `X-Relay`, `Retry-After` in whole seconds, and
`X-Relay-Error` `rate-limited` or, for the per-endpoint ceiling,
`rate-limited-endpoint`. Nothing is sent upstream for it, and no session or
callback registration is created.

**Why not in Caddy?** Caddy's stock build has no rate limiter; the plugins that
add one mean a custom build of a server that also serves the host's other
sites. And only the relay knows what a request is: which endpoint it is for,
whether it will be sent upstream, and when its body has finished. "In flight"
is held from the moment a request is sent upstream until its body is done or
broken off, not until the headers arrive: a read may stream for minutes.

**Never limited:** `/healthz`, which Docker's health check calls, and the
callbacks. An OGC server that cannot deliver a callback can damage the job it
is about (finding 0047), so a callback is answered as before, always.

**How:** a token bucket per client and route, holding one minute's budget and
refilling continuously. A fixed window allows double the rate across a window
boundary; a sliding log keeps a timestamp per request. Memory is bounded by
`maxTrackedClients` (50 000). A client whose buckets are full again is
forgotten at the minute sweep. At the bound, newcomers share one overflow
entry, rather than each getting a fresh allowance or being refused outright;
no client that is being limited is evicted to make room.

### Who the client is

The key is the address of the socket a request arrived on. `X-Forwarded-For`
is read **only** when that socket belongs to a proxy listed in
`trustedProxies`, and then only its **rightmost** entry: the one our own proxy
wrote. Anything to its left was sent by the client.

- `trustedProxies` holds loopback or private addresses or ranges only.
  Trusting a public address, or everyone, would let any client name itself.
  The production config lists exactly one address, never a range.
- An IPv4-mapped IPv6 address, which is how the relay's dual-stack listener
  reports an IPv4 peer, is taken as IPv4.
- An IPv6 client is keyed by its /64.
- A trusted proxy that names no readable client is a misconfiguration. Its
  requests share one bucket, `unknown`, and the relay's once-a-minute line
  counts them.

The one trusted address is fixed by the deployment, not measured each time:
the relay runs on its own Docker network with a fixed subnet,
`172.31.87.0/24`, that the deploy script creates and refuses to create over
another network or a host route. Its gateway is the trusted proxy when Caddy
is a system service; Caddy's fixed address on that network, `172.31.87.2`,
when Caddy runs in a container. Measured on a Linux Docker host, the relay
sees `::ffff:172.31.87.1` and `::ffff:172.31.87.2` respectively, and Caddy
2.11, with no `trusted_proxies` of its own, replaces a client's
`X-Forwarded-For` rather than appending to it.

### Logging

The relay never logs or exposes a client's address: addresses exist only as
keys in memory. At most once a minute, and only when something was refused or
a request had no readable client, it writes one line: refusals by limit, the
`unknown` and overflow counts, and how many clients it tracks. The only name
in it is an endpoint's key.

### Unknown config members

The relay's config now refuses any member it does not know, at every level.
A misspelt `rateLimits` would otherwise have started a relay that quietly ran
on its defaults.

## Alternatives considered

- **Limits in Caddy.** Rejected above: a custom build, and no view of what
  a request does upstream.
- **Trust `X-Forwarded-For` from anyone, or its leftmost entry.** Every client
  could pick its own key. Rejected.
- **No proxy, the relay published directly.** It would see real addresses, but
  then it would need its own TLS, and a second origin would bring back CORS.
  Rejected.
- **A shared store (Redis) for the counts.** The relay is one process, and its
  other state is in memory on purpose (state.ts). A restart forgets the
  counts, which costs at most one minute's allowance. Rejected.

## Consequences

- **Many people behind one address share one client's limits.** A plugfest or
  an expo hall can hit them. They are raised for the event in `relay.json`
  and redeployed (deploy/relay/README.md), never switched off.
- **The host is trusted.** With Caddy as a service, any process on the host
  that calls `127.0.0.1:8787` arrives from the same gateway as Caddy, and its
  `X-Forwarded-For` is believed.
- **Many /64s from one IPv6 allocation** can each be a client until the key
  bound; past it they share the overflow entry, and the per-endpoint ceiling
  still bounds what reaches a server (SSRF matrix, I4).
- **The page says so.** Wherever a request through the relay is refused for
  its rate, the page says "Too many requests through the relay. Try again in
  N seconds." The `endpoint-access` record says `relay-refused` with the code,
  which neither confirms nor refutes a CORS block.
- **`browserCors` exposes `Retry-After` and `X-Relay-Error`**, so a page on
  another origin, as in CI, can read a refused `/sessions`.
