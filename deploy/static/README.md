# The static web client

`apps/web`, published as plain files behind a Caddy that already serves the
host. No relay, no proxy, no callbacks: every request goes from the visitor's
browser straight to the OGC API service they choose. The relay comes later, at
`/api`, behind the same origin; until then `/api` answers 404.

| File                | What it is                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| `Caddyfile.snippet` | The site block to add to the host's Caddyfile                               |
| `config.json`       | The page's runtime config for this site: no relay, no presets yet           |
| `deploy.sh`         | Build the current commit and publish it as a new release, atomically        |
| `activate.sh`       | The server half of `deploy.sh`, fed to it over ssh; never run by hand       |
| `smoke.sh`          | Check the live site from outside with `curl`; exits non-zero on any failure |

Nothing about the host lives here: its name comes from `OAP_DEPLOY_HOST` and
`OAP_HOSTNAME`, and `oap.example.nl` below stands for the real hostname.

## What a visitor can and cannot do

**Can:**

- Connect to any public `https:` OGC API - Processes service that allows web
  pages to read it (sends CORS headers).
- Browse its processes, fill in a form generated from a description, draw
  geometry on the map, and run a process in the foreground.
- Run a process in the background where the service lets a page read the new
  job's address (`Access-Control-Expose-Headers: Location`); the page then
  polls for it.
- Download the session's observations as a file. Nothing is sent anywhere.

**Cannot, until the relay is added:**

- Use a service that sends no CORS headers. The page says so and records it.
- Find a background job on a service that hides its address from web pages
  (pygeoapi does, finding 0039): the job starts, the page cannot find it, and
  that is recorded.
- Receive callbacks.
- Reach a plain `http:` service: the browser blocks it from an HTTPS page, and
  the page refuses it before sending. This includes a server on the visitor's
  own machine (`http://localhost`): the Content-Security-Policy allows `https:`
  connections only.

## Layout on the server

```
/srv/oap-web/
  releases/
    20260928T120000Z-3f2c1a9b8d7e/   one directory per deploy: UTC time, then commit
    …                                the newest five are kept
  current -> releases/20260928T120000Z-3f2c1a9b8d7e
```

`current` is a relative symlink, so it resolves inside a container that
mounts `/srv/oap-web` too. A deploy uploads a complete release first, then
renames a new link over `current` in one step: a request sees the old release
or the new one, never a mixture and never nothing.

## First-time setup

The host serves other sites. Every step below is additive — one new directory,
one new site block — and each Caddy change is validated before it is applied,
with a graceful reload that does not drop connections.

1. **Find out how Caddy runs:** `systemctl status caddy`, or
   `docker ps --filter name=caddy`.
2. **DNS:** A and AAAA records for the hostname. Wait until
   `dig +short oap.example.nl A` and `… AAAA` return the host's addresses:
   Caddy requests the certificate on its first reload, and a record that is
   not there yet fails the ACME challenge.
3. **Web root:** `sudo mkdir -p /srv/oap-web/releases`, owned by the deploy
   user and readable by the user Caddy runs as. If Caddy runs in a container,
   it needs a read-only bind mount of `/srv/oap-web` at the same path;
   recreating that container interrupts the other sites briefly, so schedule
   it.
4. **Caddy:** append `Caddyfile.snippet` to the Caddyfile, with the real
   hostname. Then validate, and only then reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile     # or: docker exec <c> caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy                            # or: docker exec <c> caddy reload --config /etc/caddy/Caddyfile
   ```

   Until the first deploy, the new site answers 404; the other sites are
   untouched.

5. **File-integrity monitoring**, if the host runs any: exclude `/srv/oap-web`,
   or every deploy shows up as a change.

## Deploying

From a clean checkout of the commit to publish, with ssh access to the host
as the deploy user:

```bash
OAP_DEPLOY_HOST=deploy@<server> deploy/static/deploy.sh --dry-run   # builds, sends nothing, prints each step
OAP_DEPLOY_HOST=deploy@<server> deploy/static/deploy.sh
OAP_HOSTNAME=oap.example.nl deploy/static/smoke.sh
```

`deploy.sh`:

- refuses to run with uncommitted or untracked changes;
- builds `apps/web` in a detached worktree of `HEAD`, so nothing uncommitted
  or git-ignored can reach the release;
- puts `deploy/static/config.json` in it, and refuses a build with source maps
  or development addresses;
- uploads it with `rsync` to `releases/<id>/`, then runs `activate.sh` on the
  host, which checks the release, makes it readable, swaps `current`, and
  removes all but the newest five releases (never the active one);
- prints the command that rolls back to the release that was live before.

`smoke.sh` checks, from outside: `/` and `/config.json` answer 200 and are
revalidated (`no-cache`); an `/assets/` file is `immutable`; `/api`, a missing
asset and a missing page answer 404; `config.json` is JSON; and HSTS,
`nosniff`, the referrer, frame and permissions policies, and a
Content-Security-Policy are present.

## Rolling back

`deploy.sh` prints the exact command after each deploy. In general, on the
host:

```bash
cd /srv/oap-web && ls releases/            # pick the release to go back to
ln -sfn releases/<id> current.tmp && mv -Tf current.tmp current
```

Then run `smoke.sh`. No reload is needed: Caddy follows the link per request.

## Enforcing the Content-Security-Policy

The snippet sends the policy as `Content-Security-Policy-Report-Only`:
violations are reported in the browser's console and nothing is blocked. To
enforce it:

1. In Chrome and in Firefox, open the site with the developer console open,
   connect to a public HTTPS service, open a process, draw on the map, run it,
   and show an image result. The console must show no CSP reports.
2. In the snippet, rename the header to `Content-Security-Policy`, keeping the
   same value.
3. Validate, reload, and run `smoke.sh`, which accepts either header.

The policy allows scripts, styles, the map's worker and fonts from the site
itself only, images from `https:`, `data:` and `blob:` (map tiles and image
results), and connections to the site and to any `https:` host, because a
visitor may choose any HTTPS OGC API service.
