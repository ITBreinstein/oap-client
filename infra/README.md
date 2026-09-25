# Reference servers

Two implementations, because one cannot tell a server's deviation apart from an
ambiguous specification.

| Where                  | What                                                    | Lane                              |
| ---------------------- | ------------------------------------------------------- | --------------------------------- |
| `compose/pygeoapi.yml` | pygeoapi 0.21.0 on `:5080` (CORS) and `:5081` (no CORS) | `pnpm test:contract`, blocks CI   |
| `zoo/`                 | ZOO-Project fork on `:5090`                             | `pnpm test:interop`, never blocks |

```bash
docker compose -f infra/compose/pygeoapi.yml up -d --wait
./infra/zoo/zoo.sh up
```

ZOO has its own README — [zoo/README.md](zoo/README.md) — covering the fork, the
pinning and why it is not in the contract lane. The rest of this file is about
pygeoapi.

## The two pygeoapi ports

Identical configuration but for one flag. `:5080` sets `cors: true` and
exercises the direct-fetch path; `:5081` sets `cors: false`. Both are needed: a
client that only ever met a CORS-enabled server would ship with a whole class of
browser failure untested.

The relay does not rescue `:5081`. It carries the asynchronous execute and
nothing else, so on `:5081` it can name a job the browser still cannot read
(finding 0049). On `:5080` it is what makes asynchronous execution work from a
browser at all — see [relay/](relay/) and finding 0039.

What the split has actually shown, measured rather than assumed:

- On `:5080` a browser **can** `DELETE /jobs/{id}` — the `OPTIONS` preflight
  answers with `Access-Control-Allow-Methods` including `DELETE`.
- On `:5081` it cannot, because the preflight answers 200 with no CORS headers
  at all and the browser therefore never sends the `DELETE`.
- On **both**, `Location` is invisible to a browser: neither port sends
  `Access-Control-Expose-Headers`, so an asynchronous execute starts a job the
  page cannot name. Findings 0002 and 0009.
- Through the relay, on `:5080`, the browser names the job, watches it
  complete, and hears its callbacks. On `:5081` it names the job and cannot read
  it.

`e2e/jobs-cors.spec.ts` asserts the first three in a real browser, and
`e2e/relay-async.spec.ts` the last.

## Callbacks reach the host

Both ports map `host.docker.internal` to the host gateway, so pygeoapi can call
a relay — or `callbacks/listener.mjs` — running on the host. Docker Desktop
provides the name anyway; Linux, and so CI, needs the mapping. Probes for what
the servers send, and what they do when the receiver misbehaves, are in
[callbacks/](callbacks/).

## Our own processes

`pygeoapi/plugins/` holds processors this repository adds to the pinned image.
They are mounted read-only and put on `PYTHONPATH` by `compose/pygeoapi.yml`, so
they load as ordinary pygeoapi plugins with **no image rebuild** — the image
stays the pinned upstream one, and a finding that names it still names something
anyone can pull.

Registered in both `pygeoapi/config-cors.yml` and `pygeoapi/config-nocors.yml`,
because a process that exists on only one port makes the two lanes incomparable.

### `slow`

```yaml
slow:
  type: process
  processor:
    name: breinstein_slow.SlowProcessor
```

Sleeps for `seconds` (default 5, capped at 600) and returns a small JSON output,
optionally echoing a `message`.

**Why it exists.** The stock image registers one process, `hello-world`, which
completes instantly. Against it every job is `successful` before the first poll
returns, which makes the entire asynchronous surface untestable:

- a non-terminal job is never observed,
- `Retry-After` handling is never exercised,
- cancellation mid-poll cannot be tested,
- `DELETE` on a _running_ job cannot be told apart from `DELETE` on a finished
  one,
- progress reporting has no data.

ZOO's `longProcess` gives a second opinion, but the interop lane never blocks a
release, so it cannot be the deterministic lane. `slow` is what makes
`test/contract/jobs.test.ts` possible.

It is deliberately **not** specific to any use case: it sleeps and echoes, so
nothing in the client can ever be tuned to what it computes.

**What it still cannot show.** pygeoapi reports `status: "accepted"` for the
whole of a job's execution and jumps straight to `successful` — it never reports
`running`, and `progress` is a hardcoded 5 then 100 (finding 0032). `slow` makes
the job last long enough to _observe_, but the vocabulary and the progress
numbers are pygeoapi's. A genuinely `running` job with moving progress only
exists on ZOO, and the interop lane is where that is asserted.

### `breinstein-bbox`, `breinstein-inputs`, `breinstein-png`

```yaml
breinstein-bbox:
  type: process
  processor:
    name: breinstein_bbox.BboxProcessor
```

…and the same for `breinstein_inputs.InputsProcessor` and
`breinstein_png.PngProcessor`. The three coverage-gap processes that were left
on the backlog after `slow`, one hole each. `:5080` is the only server a browser
can reach (findings 0049, 0050), so without them the web client's generated form
had nothing to be tested against but two string inputs.

| Process             | Closes                               | Inputs → outputs                                                                                                                                                                                                                |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breinstein-bbox`   | a bounding-box input                 | one `format: "ogc-bbox"` object (`properties.bbox`, four numbers, and `properties.crs`, CRS84 only) → the box as a GeoJSON `Feature` polygon, `application/geo+json`                                                            |
| `breinstein-inputs` | every form control, multiple outputs | a bounded string, a multi-line string, a bounded integer, a number with a default, an enum, a boolean, a string repeatable three times, one optional string, one optional GeoJSON geometry → `echo` (JSON) and `summary` (text) |
| `breinstein-png`    | a non-JSON output                    | one bounded integer → an `image/png` of that size                                                                                                                                                                               |

Same rule as `slow`: each one **echoes or reshapes its inputs and computes
nothing**. Three details are deliberate:

- **`breinstein-bbox` refuses any CRS but CRS84** rather than reprojecting.
  Reprojection would be the process doing geography, and whether a client
  swaps axes is the client's decision to be tested, not the server's to hide.
- **`breinstein-inputs` does no validation of its own.** Whether a wrong-typed
  or out-of-range value is refused is then pygeoapi's decision alone, which is
  the thing worth measuring. It echoes the inputs as received, so a browser test
  asserts on what arrived rather than on what the client believes it sent.
  Its multi-line input is `type: "string"` with `contentMediaType: "text/plain"`:
  JSON Schema has no multi-line keyword, and this is the nearest standard one.
- **Two outputs travel as one JSON results map** (`{ "echo": …, "summary": … }`)
  because a pygeoapi processor returns one media type and one payload. Ask for
  `summary` alone and it comes back raw as `text/plain`.

`breinstein-png` builds its PNG with `zlib` and `struct` only, so the pinned
image needs no extra package.

## Re-creating the stack after a config change

`up -d` alone will not pick up a change to a mounted config or a new plugin
file — the container has to be replaced:

```bash
docker compose -f infra/compose/pygeoapi.yml up -d --force-recreate
```

Jobs live in a TinyDB file inside the container (`/tmp/pygeoapi-process-manager.db`),
so they **survive a `restart`** and are **lost on a recreate**. Worth knowing
before wondering where a demo's job went.
