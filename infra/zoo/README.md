# ZOO-Project: the second implementation

pygeoapi is one Python codebase. Everything in `findings/` so far is a statement
about that codebase, and a single-implementation matrix cannot tell "this server
is non-conformant" apart from "the specification is ambiguous and everyone reads
it differently" — which is exactly where finding 0005 was stuck.

ZOO-Project is about as far from pygeoapi as an OGC API - Processes server gets:
C and CGI behind Apache, an FPM worker, RabbitMQ, Redis and Postgres, and ~700
services. Where the two agree, the specification is probably clear. Where they
disagree, we have a finding worth writing down.

```bash
./infra/zoo/zoo.sh up        # :5090
./infra/zoo/zoo.sh ps
./infra/zoo/zoo.sh down
pnpm test:interop            # skips itself if it is not answering
```

The first `up` clones ~60 MB and compiles the ZOO kernel under amd64 emulation.
Budget twenty minutes and a coffee. Later runs reuse the image.

## Operating it

`zoo.sh up` is the only supported way in, and it is safe to re-run: it is how you
start the stack, how you restart it, and how you pick up a configuration change.

`docker start` on a stopped kernel is not. The container comes back, Apache
answers, and it serves 503 forever — the worker behind it never reattaches. `up`
recreates instead, then waits for a real landing page and recreates once more if
it does not appear, so a half-started stack fails the script rather than the
test lane.

The interop tests probe for a 200 and `application/json` before they run, for
the same reason: a 503 is a completed HTTP response, and a lane that must never
block cannot treat one as "the server is up".

## Why this is not in the contract lane

`pnpm test:contract` is the lane that blocks CI, and it earns that by being
cheap and deterministic: one pinned image, one checked-in config, green on a
laptop in seconds. ZOO is six containers and a source build. Putting it in
that lane would mean every unrelated PR waits on a kernel compile, and the first
flaky RabbitMQ start would train everyone to ignore a red build.

So ZOO lives in `pnpm test:interop`, which reports and never blocks, and whose
tests skip themselves when nothing is listening. Promote it later if it proves
boring — but only after it has been boring for a while.

## Why a fork

The deployment is pinned to a _fork_ (`pinned.env`), and the fork is not the
official ZOO-Project repository. It carries four patches — a response-output
fix, an asynchronous-worker startup fix, a build that compiles the checkout's
own kernel sources, and the bundled local process providers — and without them
there is no headless deployment here to test a client against. The checkout's
own `CODEX_FRESH_CLONE_FIX.md` documents each one.

Findings recorded against `:5090` must therefore name the fork and its SHA in
the `server` and `version` frontmatter. "ZOO-Project 2.x" would be a claim about
software nobody can download.

## Pinning

`pinned.env` holds all three pins:

- the fork commit the checkout is detached onto,
- the image tag built from it, named after that commit rather than `local`,
- the base image the fork's Dockerfile builds on, pinned to the commit tag
  Docker Hub publishes alongside `latest` (`19f3c4ee…`, which is upstream `main`
  as of 2026-07-31).

`docker/zookernel-local.Dockerfile` in the checkout builds `FROM
zooproject/zoo-project:latest`, a moving tag. `zoo.sh` resolves that by pulling
the commit-tagged image and re-tagging it as `latest` locally before building,
so the build is pinned at both ends without editing the checkout. That image is
a build input only — nothing runs it.

`infra/zoo/.checkout/` is gitignored: it is a build input, not source. `zoo.sh`
refuses to build from a dirty checkout, because an image tagged after a commit
must actually be that commit. If something in ZOO needs changing, change it in
`infra/` or write it up as a finding — never by editing the checkout in place.
