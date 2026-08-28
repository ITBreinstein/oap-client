# oap-client

Breinstein's OGC API - Processes client: a runtime-neutral protocol core, a web
interface, and a small relay for servers that do not send CORS headers.

| Workspace                      | What it is                                                      |
| ------------------------------ | --------------------------------------------------------------- |
| [packages/core](packages/core) | `@breinstein/oap-client` — the published, framework-free client |
| [apps/web](apps/web)           | Vite + React interface (static output)                          |
| [apps/relay](apps/relay)       | Hono relay, used only when a server refuses direct fetch        |

## Getting started

```bash
corepack enable
pnpm install
pnpm verify        # typecheck, lint, boundaries, format, test, build
```

Other entry points:

```bash
pnpm --filter @breinstein/web dev     # interface on :5173
pnpm test:e2e                         # Playwright, needs a built web app
pnpm test:contract                    # pinned pygeoapi; needs the compose stack up
pnpm test:interop                     # ZOO-Project and third-party servers; never blocking
pnpm test:smoke                       # consumer tests against a packed tarball
pnpm graph                            # regenerate docs/architecture.svg (needs graphviz)

docker compose -f infra/compose/pygeoapi.yml up -d   # reference servers on :5080 (CORS) and :5081 (no CORS)
./infra/zoo/zoo.sh up                               # ZOO-Project reference deployment on :5090
```

Two implementations, because one cannot tell a server's deviation apart from an
ambiguous specification. pygeoapi is the pinned, deterministic lane that blocks
CI; ZOO-Project is a second implementation with nothing in common but the
standard, and it reports without blocking — see
[infra/zoo/README.md](infra/zoo/README.md).

## Boundaries

Six rules. The first four are enforced twice — by `no-restricted-imports` in
[eslint.config.js](eslint.config.js) for direct imports, and by
[.dependency-cruiser.cjs](.dependency-cruiser.cjs) for transitive leakage:

1. `packages/core` depends on no framework and no map library.
2. `packages/core` never imports application code.
3. Only `apps/web/src/map` may import `maplibre-gl` or `terra-draw`.
4. `apps/web/src/map` knows geometry, not the protocol — it never imports the core.

A fifth rule guards the published package's runtime target: `packages/core/src`
may use no DOM-specific and no Node-specific API. `no-restricted-globals` and
`no-restricted-imports` catch direct use, dependency-cruiser catches Node
built-ins reached transitively, and two consumer smoke tests
(`pnpm test:smoke`) catch anything that survives both — see
[Supported environments](packages/core/README.md#supported-environments).

A sixth rule keeps the HTTP boundary in one place: only
`packages/core/src/http` may call `fetch`. Everything above it works in terms of
a `ResponseEnvelope` and the classifier's verdict on it.

## Toolchain

Recorded in [docs/toolchain-and-project-setup.md](docs/toolchain-and-project-setup.md).
Two things to know before touching versions:

- **TypeScript is pinned to `~6.0.0`.** TS 7 has no stable compiler API until
  7.1, so `typescript-eslint` cannot run on it (its peer range is
  `>=4.8.4 <6.1.0`). To watch the upgrade, add `@typescript/native-preview` and
  run `tsgo --noEmit` as a non-blocking sidecar lane.
- **pnpm, not npm workspaces.** Strict, non-hoisted `node_modules` is what makes
  boundary rule 1 an install-time guarantee rather than a convention.

## Licence

MIT. Third-party provenance is tracked in [THIRD_PARTY.md](THIRD_PARTY.md).
