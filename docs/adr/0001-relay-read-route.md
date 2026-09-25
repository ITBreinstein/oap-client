# 1. A read route in the relay, for configured servers without CORS

- **Status:** accepted
- **Date:** 2026-09-25
- **Where:** `apps/relay` (the route), `apps/web` (the decision and the
  record). `packages/core` is unchanged.

## Context

A web page can read another origin's answers only when that origin sends
`Access-Control-Allow-Origin`. Until now the relay did two things for a
browser: it named asynchronous jobs, because `Location` is hidden
cross-origin (finding 0039), and it relayed job callbacks. A server that
sends no CORS headers at all was recorded as blocked in a browser, and that
was the end of it.

Two reference deployments send none:

- **ZOO-Project** sends no CORS headers anywhere. A page cannot read even its
  landing page (findings 0009 and 0050). Of the two independent
  implementations the client is tested against, one could not be used from
  the web client at all.
- **pygeoapi with `cors: false`** (`:5081`) behaves the same way (finding
  0049). It exists in the reference stack to show what that deployment
  choice costs.

Two requirements pull against each other:

1. **The client should be usable against these servers**, for a demonstration
   and for the process census that feeds the form-generation catalogue.
2. **The finding must survive.** The interoperability matrix has to go on
   saying that the server cannot be used from a web page. A relay that
   quietly proxied everything would make ZOO look browser-ready, and hide the
   one fact about it that matters most to anyone building a browser client.

## Decision

Add a **read route** to the relay. The plan's phase 3 foresaw one once a server
had been shown to need it. It works under four conditions:

| Condition                                         | Meaning                                                                                                                                                                                                                                                                             | Enforced in          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Opt-in per endpoint**                           | Only an endpoint configured with `readRoute: "relay"` (which also needs `executeRoute: "relay"`). The browser never supplies a URL, only a path relative to that endpoint's `baseUrl`.                                                                                              | relay config, routes |
| **Direct first, and only after the user says so** | The page always tries the server directly. It offers the relay only for a failure shaped like a missing CORS header, and sends nothing through it until the user clicks "Use relay". Cancel and Escape are a decline. The choice holds for that one connection and is never stored. | web app              |
| **Recorded**                                      | Each attempt leaves one `endpoint-access` observation: the direct outcome, always, then whether the user confirmed, how the relay attempt ended, and the route used. The relay writes one audit line per forwarded request.                                                         | web app, relay       |
| **Narrow**                                        | `GET` under `baseUrl`, `DELETE` on one job, and the synchronous execute. Header allowlists in both directions, caps on size and time, no cookies, and an address check on every hop.                                                                                                | relay                |

While the relay is in use, the page shows a banner that cannot be dismissed.

The mechanics are in [apps/relay/README.md](../../apps/relay/README.md):
routes, headers, redirects, caps, the `X-Relay` and `X-Relay-Error` markers,
and the audit line. The web side is in [apps/web/README.md](../../apps/web/README.md).

### How the matrix reads it

Whether a server is **usable from a web page** is decided by the direct
attempt alone. A server that worked only through the relay is not.

The relay attempt adds confirmation. From inside a page, a CORS block and a
server that is down look the same: a request that produced no readable
response. When the relay then reaches the server (`relayOutcome` `ok`, or
`other-failure`, which means the server's own answer came back), the server
was up, so the direct failure was CORS. A relay `timeout` or
`connection-failed` means the server is likely down. `blocked-address`
means our relay's configuration. Anything else leaves the block unconfirmed.

## Alternatives considered

- **Leave it blocked.** This keeps the finding and is the simplest option.
  But one of the two reference implementations would stay untestable from the
  web client, the form generator would never meet ZOO's 700 process
  descriptions in a browser, and a demonstration could show ZOO only failing.
  Rejected, because the read route can have the benefit without losing the
  finding.
- **A general CORS proxy**, taking any URL from the page. This is an open
  proxy: anyone can send requests from the relay's network position. It also
  hides the finding. Rejected.
- **Fall back automatically**, without asking. The user would not know their
  requests were leaving the browser through a third party, and "worked" would
  mean something different from one server to the next. Rejected: the click
  is what makes the fallback visible and recorded.
- **Put the route in the core**, as a new observation kind in the published
  `Observation` union. The relay is this web app's component. A consumer of
  `@breinstein/oap-client` without our relay would be carrying a vocabulary
  for something it cannot have. The route decision stays in the web app's own
  `endpoint-access` record. Rejected.

## Consequences

- **Relay contract change.** For a `readRoute: "relay"` endpoint,
  `POST /execute` without `Prefer: respond-async` is now a synchronous
  execute, and the server's answer comes back raw, so a PNG result reaches the
  page intact. The web client always sends `Prefer: respond-async` for an
  asynchronous one. An older web build talking to this relay would get raw
  answers for its asynchronous executes on such endpoints. Endpoints without
  `readRoute` behave as before.
- **A larger outbound surface.** The relay now makes reads on a page's behalf.
  The conditions above bound them, but the relay's existing gaps weigh more:
  it has no rate limiting yet (apps/relay/README.md, "Not yet done"), and it
  must not face the internet without it.
- **CI shows both sides.** `infra/relay/ci.json` lists `:5081` twice.
  `pygeoapi-nocors` is direct-only, so the blocking lane keeps showing the
  unassisted failure. `pygeoapi-nocors-relay` puts the read route in the
  blocking lane. ZOO's browser tests use the read route and stay non-blocking.
- **Known limits.**
  - A cap hit in the middle of a body cannot become a `502`, because the
    status has already gone out. The stream is broken off instead.
  - When the relay follows a redirect, the core still resolves relative links
    against the URL it asked for. Neither reference server redirects.
