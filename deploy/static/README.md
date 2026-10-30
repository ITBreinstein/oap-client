# The static web client

`apps/web`, published as plain files behind a Caddy that already serves the
host. Requests go from the visitor's browser straight to the OGC API service
they choose, except for the servers the relay is configured for, which it
reaches through the relay at `/api` on the same origin, once the visitor
agreed. The relay is deployed separately, from
[`deploy/relay/`](../relay/README.md); no callbacks.

| File                | What it is                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| `Caddyfile.snippet` | The site block to add to the host's Caddyfile                               |
| `config.json`       | The page's runtime config for this site: the relay at `/api`, no presets    |
| `deploy.sh`         | Build the current commit and publish it as a new release, atomically        |
| `activate.sh`       | The server half of `deploy.sh`, fed to it over ssh; never run by hand       |
| `oap-receive.sh`    | The server half of automatic deploys, installed as `oap-receive`            |
| `test/`             | The receiver's test, run in CI                                              |
| `smoke.sh`          | Check the live site from outside with `curl`; exits non-zero on any failure |

Nothing about the host lives here: its name comes from `OAP_DEPLOY_HOST` and
`OAP_HOSTNAME` (for automatic deploys, from the GitHub environment), and `oap.example.nl` below stands for the real hostname.

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

**With the relay, for the servers listed in `deploy/relay/relay.json` only:**

- Use a service that sends no CORS headers. The page tries it directly first,
  records the failure, and offers the relay; only after **Use relay** is
  anything sent through it (ADR 0001).
- Find a background job on a service that hides its address from web pages
  (pygeoapi does, finding 0039): the relay starts the job and names it.
- Within the relay's rate limits (ADR 0003). Past them, the page says how
  long to wait.

**Cannot:**

- Use a service without CORS that the relay is not configured for, including
  any address typed in: those are always reached directly. The page says so
  and records it.
- Receive callbacks: they stay off (finding 0047), and the page polls.
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
   user (`oap-ci` for [automatic deploys](#automatic-deploys)) and readable by the user Caddy runs as. If Caddy runs in a container,
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
   untouched. Until the relay is deployed, `/api/…` answers 502. The order
   for a first deployment with the relay is in
   [`deploy/relay/README.md`](../relay/README.md#first-deployment): the relay
   first, then this block, then the site.

5. **File-integrity monitoring**, if the host runs any: exclude `/srv/oap-web`,
   or every deploy shows up as a change.

## Deploying by hand

Merges to `main` deploy by themselves; see
[Automatic deploys](#automatic-deploys). By hand, from a clean checkout of the commit to publish, with ssh access to the host
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
revalidated (`no-cache`); an `/assets/` file is `immutable`; bare `/api`, a
missing asset and a missing page answer 404; `config.json` is JSON; and HSTS,
`nosniff`, the referrer, frame and permissions policies, and a
Content-Security-Policy are present. For the relay: `/api/healthz` answers 200
with `X-Relay: 1`; `/api/endpoints` lists `https:` servers only; a read
without a session is the relay's own `401`; and port 8787 does not answer on
any of the host's addresses. `SMOKE_RATE_LIMIT=1` also checks that sessions
are rate-limited whatever `X-Forwarded-For` says. That leaves the machine
running it rate-limited for about a minute.

## Automatic deploys

Every merge to `main` deploys, with
[`.github/workflows/deploy-web.yml`](../../.github/workflows/deploy-web.yml).
A `build` job builds `apps/web` from that commit exactly as `deploy.sh` does,
adds `config.json`, makes the same checks, and packs the result into one
`.tar.gz`. It holds no secret. A `deploy` job then sends that archive over
plain `ssh` to the host, with a key that can do one thing only: run
[`oap-receive.sh`](oap-receive.sh) (installed as `oap-receive`), which checks
the archive, unpacks it into `releases/<id>/`, swaps `current` and keeps the
newest five releases, in the layout above. Last, `smoke.sh` checks the live
site. A failing smoke test fails the run but rolls nothing back.

Deploys run one at a time. A deploy that has started always finishes; if
several merges land while one runs, only the newest of those waiting is
deployed after it. **Actions → deploy-web → Run workflow** deploys `main` again
by hand.

The steps below are done once, by hand, by an administrator of the host and
of the GitHub repository. `<server>` stands for the host's ssh address and
`oap.example.nl` for the site's hostname.

### On the host

1. **A user for CI**, with no password, no sudo and no groups but its own:

   ```bash
   sudo useradd --system --create-home --shell /bin/sh oap-ci
   id oap-ci                                    # groups=…(oap-ci) and nothing else
   sudo sshd -T | grep -iE '^(allow|deny)(users|groups)'
   ```

   It needs a real shell: sshd runs the forced command through it. If the last
   command prints an `AllowUsers` or `AllowGroups` line, add `oap-ci` to it in
   `/etc/ssh/sshd_config` (or a file in `sshd_config.d/`), then
   `sudo sshd -t && sudo systemctl reload ssh`.

2. **The web root, owned by `oap-ci`.** It is the only thing that user can
   write to:

   ```bash
   sudo install -d -o oap-ci -g oap-ci -m 755 /srv/oap-web /srv/oap-web/releases
   sudo chown -R oap-ci:oap-ci /srv/oap-web     # only if releases from deploy.sh are already there
   ```

3. **The receiver**, owned by root, so `oap-ci` cannot change it. From a
   checkout of the reviewed commit:

   ```bash
   scp deploy/static/oap-receive.sh admin@<server>:
   ssh -t admin@<server> sudo install -o root -g root -m 755 oap-receive.sh /usr/local/bin/oap-receive
   ```

   The copy in this repository is the source of truth: after a change to it is
   merged, install it again. `sha256sum` on both sides tells whether they match.

4. **The key.** Make a new key pair for this purpose only, on your own
   machine, with no passphrase (CI cannot type one):

   ```bash
   ssh-keygen -t ed25519 -N '' -C oap-ci@github-actions -f oap-ci-deploy
   ```

   On the host, allow it for `oap-ci`, locked to the receiver. `restrict`
   turns off everything else a key could do (a terminal, port and agent
   forwarding); `command=` makes sshd run `oap-receive` whatever command the
   client asks for, and pass that request on in `SSH_ORIGINAL_COMMAND`. The
   file and its folder are owned by root, so not even `oap-ci` can add a key:

   ```bash
   sudo install -d -o root -g root -m 755 ~oap-ci/.ssh
   echo 'restrict,command="/usr/local/bin/oap-receive" ssh-ed25519 AAAA… oap-ci@github-actions' |
     sudo tee ~oap-ci/.ssh/authorized_keys
   sudo chmod 644 ~oap-ci/.ssh/authorized_keys
   ```

   with the contents of `oap-ci-deploy.pub` after `command="…"`.

5. **Check the lock** from your own machine. Each of these must be refused:

   ```bash
   ssh -i oap-ci-deploy -o IdentitiesOnly=yes oap-ci@<server> ls /
   # refused: only 'deploy <sha>' is allowed
   tar -czf - -T /dev/null |
     ssh -i oap-ci-deploy -o IdentitiesOnly=yes oap-ci@<server> deploy 0000000000000000000000000000000000000000
   # refused: release has no index.html
   ```

   Nothing under `/srv/oap-web` changes. Once the GitHub settings below are
   in, delete `oap-ci-deploy` from your machine: the secret is the only copy
   the deploys need.

### On GitHub

In the repository's **Settings → Environments**, create an environment
`production`:

- **Deployment branches and tags:** selected branches, `main` only. Only a
  job on `main` can then read the secret below.
- **Environment secret** `OAP_DEPLOY_KEY`: the whole private key,
  `oap-ci-deploy`, including its first and last line.
- **Environment variables:**
  - `OAP_DEPLOY_HOST`: `oap-ci@<server>`;
  - `OAP_HOSTNAME`: `oap.example.nl`, for the smoke test;
  - `OAP_KNOWN_HOSTS`: the host's public ssh key, as a `known_hosts` line.
    The deploy refuses any host whose key is not this one, so get it and check
    it:

    ```bash
    ssh-keyscan -t ed25519 <server> > oap-known-hosts       # on your machine: what the network says
    ssh-keygen -lf oap-known-hosts
    ssh admin@<server> ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub   # what the host says
    ```

    The two `SHA256:…` fingerprints must be identical; then paste the line in
    `oap-known-hosts` as the value.

Optionally, **Required reviewers** on the environment makes every deploy wait
for an approval in the Actions tab.

### Rolling back an automatic deploy

As an administrator on the host, switch `current` as `oap-ci`, so that what
the next deploy finds still belongs to it:

```bash
ls /srv/oap-web/releases/
sudo -u oap-ci sh -c 'cd /srv/oap-web && ln -sfn releases/<id> current.tmp && mv -Tf current.tmp current'
```

The next merge deploys `main` again. To keep the rollback, revert the commit
on `main` instead: that merge deploys the reverted state.

### Revoking the key

```bash
sudo truncate -s 0 ~oap-ci/.ssh/authorized_keys
```

and delete `OAP_DEPLOY_KEY` from the environment. Deploys then fail at
`ssh`, and nothing else changes. To deploy again, make a new key (step 4).

### When the host key changes

After a reinstall or a host key rotation, deploys fail with
`Host key verification failed`. That is the check working: repeat the
`ssh-keyscan` step, compare the fingerprints, and replace `OAP_KNOWN_HOSTS`.

### `deploy.sh` as a fallback

`deploy.sh` still works, but it writes to `/srv/oap-web` as the deploy user,
which no longer can without `sudo`: the web root belongs to `oap-ci`. If
Actions is unavailable, an administrator can hand the web root over for one
deploy and back:

```bash
ssh -t admin@<server> sudo chown -R deploy:deploy /srv/oap-web
OAP_DEPLOY_HOST=deploy@<server> deploy/static/deploy.sh
ssh -t admin@<server> sudo chown -R oap-ci:oap-ci /srv/oap-web    # before the next merge
```

Otherwise, **Run workflow** (above) is the simpler way to redeploy.

## Rolling back

For a release from an automatic deploy, see
[above](#rolling-back-an-automatic-deploy). `deploy.sh` prints the exact command after each deploy. In general, on the
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
