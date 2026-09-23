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
./infra/zoo/zoo.sh refresh   # fresh pool of async workers — read below
./infra/zoo/zoo.sh ps
./infra/zoo/zoo.sh down
pnpm test:interop            # refreshes first; skips itself if nothing answers
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

## Asynchronous capacity decays and does not recover

The single most important operational fact about this deployment, and the one
that will waste your afternoon if you do not know it.

The number of `zoo_loader_fpm` workers falls at about one per asynchronous job
run, and never climbs back. It starts at `[server] async_worker` — twenty,
which is upstream's own value in every `main.cfg` in the checkout, not a choice
we made. So the concurrency this deployment can manage is not a constant: it is
twenty minus roughly every asynchronous job it has run since the container
started. Sequential or concurrent makes no difference; what counts is how many
jobs have run.

The process-level cause is **not** established — new worker processes do appear
alongside the disappearing ones, so "forked once and never replaced" is not
what is happening. Finding 0044 says what was and was not determined. Do not
repeat a mechanism; the measured rate is the part that holds.

Measured on 2026-09-22 with `infra/zoo/characterise-pool.mjs`, six identical
waves of four jobs against a freshly started worker container:

| jobs run so far | workers | wall clock | outcome                 |
| --------------- | ------- | ---------- | ----------------------- |
| 0               | 20      | 21.8 s     | 4/4 successful          |
| 4               | 18      | 21.0 s     | 4/4 successful          |
| 8               | 14      | 21.5 s     | 4/4 successful          |
| 12              | 10      | 41.5 s     | 4/4, concurrency halved |
| 16              | 5       | 90.6 s     | 2/4, two orphaned       |
| 20              | 1       | 90.4 s     | 0/4, all orphaned       |

The end state is worse than slow. A depleted deployment still answers `201` to
an execute request and still creates the job; the job simply never runs and
never leaves `running` — and the job list and the job document then disagree
with each other about those orphans, the list being the optimistic one. All of
it is finding 0044.

```bash
./infra/zoo/zoo.sh refresh   # restarts zoofpm only; job history survives
```

`pnpm test:interop` does this for you before every run. Be clear about what it
buys: **it resets the counter, it does not fix the defect.** A deployment
serving real users cannot restart between them. The restart exists so that a
red interop lane means something about our client, and for no other reason.

One interop run costs roughly half the pool, so without the refresh the lane
degrades on about the fourth consecutive run and fails on the fifth.

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
