# The relay, deployed

`apps/relay` as a container on the same host as the static web client, behind
the same Caddy, at `/api` on the same origin. It lets the page read the OGC
servers listed in `relay.json` that send no CORS headers, after the visitor
confirmed it (ADR 0001), and it names jobs those servers start. It is rate
limited per visitor and per server (ADR 0003). Callbacks stay off.

| File           | What it is                                                                         |
| -------------- | ---------------------------------------------------------------------------------- |
| `relay.json`   | The relay's config: the servers it may read, and the one proxy it trusts           |
| `run-flags.sh` | How the container runs, and its network, in one place; CI runs the image with it   |
| `deploy.sh`    | Build the current commit's image, ship it with `relay.json`, and replace the relay |
| `activate.sh`  | The server half of `deploy.sh`, fed to it over ssh; never run by hand              |

Nothing about the host lives here: its name comes from `OAP_DEPLOY_HOST` and
`OAP_HOSTNAME`, and `oap.example.nl` below stands for the real hostname. The
static site's own files are in [`deploy/static/`](../static/).

## What goes in `relay.json`

- **Endpoints:** only servers whose operators agreed to be reached through
  this relay. Each is `https:` on a public host, with `callbacks` off. Leave
  out `allowPrivateNetwork`, and never set `RELAY_ALLOW_PRIVATE_ADDRESSES`:
  every address a name resolves to is checked when the relay connects.
- **No `publicUrl`:** only callbacks need one, and they are off (finding
  0047).
- **`allowedOrigins: []`:** the page and the relay share one origin, so the
  browser makes no cross-origin request to the relay at all.
- **`trustedProxies`:** exactly one address, decided by how Caddy runs (below),
  never a range.
- **`rateLimits`:** absent, so the production values apply. See "Raising the
  limits for an event".

`deploy.sh` checks all of this with the relay's own config parser before it
builds anything, and refuses a config that lists no endpoints.

## The network, and the one trusted proxy

The relay runs on its own Docker network, `oap-relay`, with a fixed subnet,
`172.31.87.0/24`, that `deploy.sh` creates on the first deploy. Docker gives
automatic addresses from the upper half only (`172.31.87.128/25`). Without
that, the relay itself took `.2`, the address kept for Caddy. The script
refuses to create the network if its subnet overlaps another Docker network
or any route on the host. If it does, choose another subnet in
`run-flags.sh` (not in `10.0.0.0/8`), and change `trustedProxies` with it.

The relay reads `X-Forwarded-For` only from one address, and then only the
rightmost entry, the one Caddy wrote. Which address depends on how Caddy runs.
Find out with `systemctl status caddy` or `docker ps --filter name=caddy`.

**Caddy as a system service** (`OAP_RELAY_CADDY=service`, the default):

- The relay's port is published on `127.0.0.1:8787` only. Docker writes its
  own firewall rules, which bypass UFW, so a bare `-p 8787:8787` would be
  public.
- Caddy's connections reach the relay from the network's gateway, `172.31.87.1`
  (measured: the relay sees `::ffff:172.31.87.1`). So
  `"trustedProxies": ["172.31.87.1"]`.
- Any other process on the host that calls `127.0.0.1:8787` arrives from the
  same gateway and is trusted too. The host is trusted anyway.
- The Caddy block is `reverse_proxy 127.0.0.1:8787`. Not `localhost`, which
  may resolve to `::1`, where nothing listens.

**Caddy in a container** (`OAP_RELAY_CADDY=container`):

- The relay publishes no port at all. Caddy joins the relay's network at the
  fixed address `172.31.87.2`, so `"trustedProxies": ["172.31.87.2"]`.
- Attach Caddy once:

  ```bash
  docker network connect --ip 172.31.87.2 oap-relay <caddy container>
  ```

  It keeps the address across restarts. A container that is _recreated_
  (`docker rm` and `run`, or `compose up` after a change) loses it, so run the
  command again after that, or, if Caddy is run by compose, declare it there:

  ```yaml
  services:
    caddy:
      networks:
        default: {}
        oap-relay:
          ipv4_address: 172.31.87.2
  networks:
    oap-relay:
      external: true
  ```

- The Caddy block is `reverse_proxy oap-relay:8787`: Docker's own DNS
  resolves the container name on that network.
- Each deploy says which container holds `.2`, or warns that none does.

## First deployment

The host serves other sites. Every step below is additive, and each Caddy
change is validated before it is applied.

0. **On the host, once:** Docker, `bash`, `gzip` and `ip`; the deploy user in
   the `docker` group (which is as good as root on that host, so use the same
   user the static deploy uses); and `sudo install -d -o <deploy user>
/srv/oap-relay`.
1. **Deploy the relay**, from a clean checkout of the commit to deploy:

   ```bash
   OAP_DEPLOY_HOST=deploy@<server> deploy/relay/deploy.sh --dry-run   # builds, checks, sends nothing
   OAP_DEPLOY_HOST=deploy@<server> deploy/relay/deploy.sh
   ```

   Add `OAP_RELAY_CADDY=container` when Caddy runs in a container.

2. **Check it on the host:** `curl http://127.0.0.1:8787/healthz` answers
   `{"ok":true}`. With Caddy in a container, check
   `docker inspect -f '{{.State.Health.Status}}' oap-relay` instead.
3. **Caddy:** replace the site block's `@api` block with the one in
   [`deploy/static/Caddyfile.snippet`](../static/Caddyfile.snippet), then
   validate, and only then reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile     # or: docker exec <c> caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy                            # or: docker exec <c> caddy reload --config /etc/caddy/Caddyfile
   ```

4. **Deploy the web client** with the new `deploy/static/config.json`, which
   points the page at `/api` and lists the relayed servers as presets:
   `deploy/static/deploy.sh`.
5. **Smoke:** `OAP_HOSTNAME=oap.example.nl deploy/static/smoke.sh`.
6. **In a browser:** open the site, choose a relayed server, see the CORS
   failure and the offer, click **Use relay**, list its processes, and run
   one.

## Deploying again, and rolling back

`deploy.sh`:

- refuses to run with uncommitted or untracked changes, and builds in a
  detached worktree of `HEAD`;
- checks `relay.json` as described above;
- builds the image for the host's CPU, read with `uname -m` over ssh. An
  Apple-silicon Mac builds `arm64` by default, which an x86 server cannot
  run. `OAP_RELAY_PLATFORM=linux/amd64` overrides it;
- tags it `oap-relay:<commit>`, sends it with `docker save | ssh … docker
load`, and puts `relay.json` beside it as `/srv/oap-relay/configs/<commit>.json`
  (`OAP_RELAY_ROOT` overrides the directory). Each release keeps its own
  config, so a rollback runs an older relay with the config it was deployed
  with, not a newer one it might refuse;
- replaces the container with the settings in `run-flags.sh` and waits until
  Docker reports it `healthy`. If it does not, the container it replaced is
  started again and the script fails;
- keeps the newest five images and configs, and always the previous one;
- prints the command that rolls back to the relay that ran before:

  ```bash
  OAP_DEPLOY_HOST=deploy@<server> deploy/relay/deploy.sh --activate <previous commit>
  ```

The relay is down for the few seconds between the old container stopping and
the new one listening. Caddy answers `502` meanwhile, without `X-Relay`, and
the page reads that as the relay being unreachable, never as the OGC server's
answer.

## Raising the limits for an event

A plugfest or an expo hall puts many people behind one public address, and
they then share one visitor's limits (apps/relay/README.md, "Rate limits").
Before the event, add a `rateLimits` block to `relay.json`, commit, and
deploy. For example:

```json
"rateLimits": {
  "perClient": {
    "sessionsPerMinute": 200,
    "executesPerMinute": 400,
    "readsPerMinute": 5000,
    "endpointsAndPreflightsPerMinute": 2000,
    "openStreams": 80,
    "inFlight": 60
  }
}
```

Members you leave out keep their defaults. The per-endpoint ceiling
(`perEndpoint`) protects the servers themselves; raise it only with their
operators' agreement. Afterwards, remove the block and deploy again. There is
no switch that turns the limits off.

## Taking the relay offline

1. Set `"relay": null` in `deploy/static/config.json` and deploy the web
   client. The page stops offering the relay; servers without CORS are
   reported as unreachable from a web page, and that is recorded.
2. Then stop the relay: `docker rm -f oap-relay` on the host.
3. Optionally, put the `@api` block back to `respond 404`. Until then Caddy
   answers `/api` with `502`.

In the other order, a page loaded before step 1 sees the relay as unreachable
and says so; nothing breaks, but it offers what it cannot deliver.

## Logs

`docker logs oap-relay`. Rotated at 10 MB, five files. The relay writes:

- one redacted audit line per forwarded read or execute: the endpoint key, the
  path under it, the _names_ of query parameters, status, bytes and time;
- at most one line a minute, and only when the rate limits refused something
  or a request named no client: refusals by limit, never an address.

It never logs a client's address, a token or a body.
