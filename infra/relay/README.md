# Relay configurations

What the relay is for, and every field, are in
[apps/relay/README.md](../../apps/relay/README.md) and
[apps/relay/src/config.ts](../../apps/relay/src/config.ts). This directory
holds two configurations.

## `ci.json` — CI, the E2E lane, and local development

Used by `playwright.config.ts`. The OGC servers call the relay back as
`host.docker.internal:8787`.

| Endpoint          | Route | Callbacks | Why it is here                                                                        |
| ----------------- | ----- | --------- | ------------------------------------------------------------------------------------- |
| `pygeoapi-cors`   | relay | **on**    | Async via callbacks against pygeoapi, verified end to end in CI                       |
| `pygeoapi-nocors` | relay | off       | So the E2E lane shows it failing: the relay names the job, the browser cannot read it |
| `zoo`             | relay | off       | Same, against ZOO (finding 0050); skipped when ZOO is not running                     |

Every endpoint sets `allowPrivateNetwork`, because the reference servers are on
`localhost`. That switch turns off the relay's address checks for that
endpoint and has no place in a public deployment. So it counts only when the
relay also runs with `RELAY_ALLOW_PRIVATE_ADDRESSES=1`, as Playwright starts it;
without that, this config refuses to start.

## `demo.example.json` — template for the public demo

Callbacks **off**: a long-running demo relay will be redeployed, and
against pygeoapi every redeploy is a window in which a job's callback can fail
and damage the job (finding 0047). Polling finds every job regardless. Turn
callbacks on only for an endpoint where the relay's uptime is guaranteed for as
long as its jobs run; the reasons are in
[apps/relay/README.md](../../apps/relay/README.md#the-three-per-endpoint-decisions).

`allowPrivateNetwork` is absent, so every address each endpoint resolves to is
checked when the relay connects. Every endpoint must be `https:` on a public
host, or the relay refuses to start. Run it without
`RELAY_ALLOW_PRIVATE_ADDRESSES`. `publicUrl` only matters once an endpoint
turns callbacks on. Replace the `example.org` hosts; nothing else needs
changing to start.
