# @breinstein/ogcapi-processes-core

A runtime-neutral [OGC API - Processes](https://ogcapi.ogc.org/processes/) client:
discovery, conformance, process listing, execution, job polling and results.

```bash
pnpm add @breinstein/ogcapi-processes-core
```

```ts
import { createClient } from "@breinstein/ogcapi-processes-core";

const client = createClient({ baseUrl: "https://example.org/ogc" });
const res = await client.request("processes");
```

## Supported environments

- **ESM only.** No CommonJS build is published. There is no `main` field — a CJS
  consumer must use dynamic `import()`. If that turns out to matter, publishing
  CJS is a later decision, made with evidence behind it.
- **Node 18 or later.**
- **Modern browsers**, on an ES2022 baseline.
- **`fetch` is injected**, so any environment providing a WHATWG-compatible
  `fetch` works — workers, Deno, Bun, or a test double:

  ```ts
  createClient({ baseUrl, fetch: myFetch });
  ```

  Omit it and the ambient `globalThis.fetch` is used, which Node 18+ and
  browsers both provide.

The package contains no DOM-specific and no Node-specific API. That is enforced,
not promised — see below.

## How the runtime target is enforced

| Check                               | Catches                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `no-restricted-globals` on `src/**` | `window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `location`, `Buffer`, `process`, `__dirname`, `__filename` |
| `no-restricted-imports` on `src/**` | `node:*` and the bare built-ins (`fs`, `path`, `http`, `https`, `stream`, `buffer`, `url`, `crypto`)                            |
| `dependency-cruiser`                | a Node built-in reached _transitively_, through a dependency                                                                    |
| no `@types/node` in this package    | `Buffer` and `node:` imports type-checking silently                                                                             |
| Node consumer smoke test            | DOM-only API in the published bundle                                                                                            |
| Browser bundle smoke test           | Node-only import in the published bundle                                                                                        |
| `publint` + `attw` on the tarball   | broken exports map, or types that resolve for us but not for a consumer                                                         |

The last three run against a packed tarball installed into a throwaway directory
outside the repo, not against the workspace source. Run them with
`pnpm test:smoke` from the repo root.

Part of the [oap-client](https://github.com/breinstein/breinstein-oap-client) monorepo. MIT.
