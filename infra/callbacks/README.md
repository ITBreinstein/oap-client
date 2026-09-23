# Callback and job-list probes

The instruments behind findings 0047 and 0048 and the 2026-09-23 addenda to
0038 and 0039. They talk to the reference servers directly, without the client
or the relay, so that what they record is the server's behaviour and nothing
else. The findings name the fixtures these produced; this is how to produce
them again.

| Script                 | Answers                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `listener.mjs`         | Which subscriber URIs a server calls, in what order, and with what             |
| `probe-subscriber.mjs` | Starts a job with a `subscriber`, reads `Location`, polls it to the end        |
| `walk-job-list.mjs`    | Whether a job just started is reachable through `GET /jobs`, and on which page |
| `limit-listener.mjs`   | Whether a size-limited receiver damages the job whose output it refuses        |

## Reproducing the callback measurements

The servers call back from their containers, so the listener has to be
reachable from there: `host.docker.internal`, which Docker Desktop provides and
`infra/compose/pygeoapi.yml` maps for Linux.

```bash
docker compose -f infra/compose/pygeoapi.yml up -d --wait
./infra/zoo/zoo.sh refresh               # before any ZOO measurement — finding 0044

node infra/callbacks/listener.mjs &      # :9911, appends to callbacks.jsonl
node infra/callbacks/probe-subscriber.mjs pygeoapi success
node infra/callbacks/probe-subscriber.mjs pygeoapi failure
node infra/callbacks/probe-subscriber.mjs zoo success
node infra/callbacks/probe-subscriber.mjs zoo failure
```

The receiver-fault cases in finding 0047, one at a time, with `:9912` standing
in for a receiver that is down:

```bash
DEAD=http://host.docker.internal:9912/cb
HOOK=http://host.docker.internal:9911/cb
TAG=unreach-all     S_BASE=$DEAD IP_BASE=$DEAD F_BASE=$DEAD node infra/callbacks/probe-subscriber.mjs pygeoapi success
TAG=unreach-success S_BASE=$DEAD                          node infra/callbacks/probe-subscriber.mjs pygeoapi success
TAG=hang-inprogress IP_BASE=$HOOK/hang                     node infra/callbacks/probe-subscriber.mjs pygeoapi success
TAG=500-all S_BASE=$HOOK/status500 IP_BASE=$HOOK/status500 F_BASE=$HOOK/status500 \
                                                           node infra/callbacks/probe-subscriber.mjs pygeoapi success
TAG=unreach-failed  F_BASE=$DEAD                           node infra/callbacks/probe-subscriber.mjs pygeoapi failure
```

Each run writes `run-<label>.json` in the working directory, and the listener
appends every callback it received to `callbacks.jsonl`. Neither is committed:
the fixtures under `packages/core/test/fixtures/*/callbacks/` are the curated
evidence, reconstructed from those records.

## Reproducing the job-list walk

```bash
node infra/callbacks/walk-job-list.mjs
```

Prints, every 2 s for 60 s, where in the list the new job sits. Its answer on
2026-09-23 is in finding 0039's addendum.

## Not part of any test lane

These are measuring instruments, run by hand when a finding needs one. The
lanes that pin the behaviour they found are
`apps/relay/test/contract/callbacks.test.ts` (0047 and the relay against real
callbacks) and `e2e/relay-async.spec.ts` (0039 from a browser).
