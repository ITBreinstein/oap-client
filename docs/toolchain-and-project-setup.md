# Toolchain and project setup

**Status:** accepted; scaffolded on 21 August 2026
**Scope:** this monorepo (`packages/core`, `apps/web`, `apps/relay`)

## 1. The stack

| Concern             | Choice                                                  | Why this one                                                                               |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Runtime             | Node 24 LTS, pinned                                     | Current active LTS; Node 26 becomes LTS in October, mid-testbed — do not chase it          |
| Package manager     | **pnpm** workspaces                                     | Strict, non-hoisted `node_modules` turns the boundary table into an install-time guarantee |
| Task running        | plain `pnpm -r` scripts                                 | Three workspaces. Turborepo/Nx is overhead you will not recover                            |
| Language            | **TypeScript 6.0.x**, pinned                            | TS 7.0 has no stable compiler API until 7.1, so `typescript-eslint` cannot run on it       |
| Lint                | ESLint flat config + `typescript-eslint` (type-checked) | Type-aware rules matter for the polling/AbortController code                               |
| Format              | Prettier                                                | Boring, universal, zero argument surface                                                   |
| Boundaries          | `dependency-cruiser`                                    | Encodes the boundary rules as a CI gate and renders the architecture graph                 |
| Unit/contract tests | Vitest + MSW                                            | One runner for core (node) and web (jsdom); MSW gives real request/response assertions     |
| Browser E2E         | Playwright                                              | The only way to observe real CORS and `Access-Control-Expose-Headers` behaviour            |
| Reference service   | Docker Compose, pinned pygeoapi image                   | Deterministic CI lane                                                                      |
| Core build          | `tsdown` (Rolldown)                                     | ESM + CJS + `.d.ts` in one step, with `publint` and `attw` built in                        |
| Web build           | Vite + React                                            | Static output, no server needed for phase 1                                                |
| Relay               | Hono on Node                                            | Small, first-class SSE (`streamSSE`), trivially containerised and unit-testable            |
| CI                  | GitHub Actions                                          | One blocking `verify` lane, one non-blocking `interop` lane                                |
| Publishing          | npm **trusted publishing** (OIDC)                       | No long-lived `NPM_TOKEN`; free SLSA provenance attestation                                |
| Git hooks           | lefthook (optional)                                     | Single binary, fast; skip it if CI feedback is enough. Not installed.                      |

### Two places this amends the architecture document

**pnpm instead of npm workspaces.** npm hoists everything into the root
`node_modules`, so `packages/core` could import `react` or `maplibre-gl` without
declaring them and nothing would complain until someone installed the published
package. pnpm makes that import fail at build time. Given that "the core must not
depend on the web interface or map" is one of only four hard boundaries, get the
package manager to enforce it for free.

**Do not adopt TypeScript 7 yet.** It is genuinely 8–12x faster, and tempting.
But `typescript-eslint` (and `ts-morph`, `api-extractor`, and the template
checkers) depend on the compiler API, which TS 7.0 shipped without. This is not
a judgement call — `typescript-eslint@8.67.0` declares
`"typescript": ">=4.8.4 <6.1.0"`, so TS 7 is a hard install-time failure, not a
soft one. Pin `typescript@~6.0.0`. If type-check speed ever hurts, install
`@typescript/native-preview` and run `tsgo --noEmit` as a _non-blocking_ sidecar
lane to catch diagnostics drift early — that also de-risks the eventual upgrade.

### The one alternative worth considering

**Biome 2.x** replaces ESLint + Prettier with a single Rust binary, does
type-aware linting without booting `tsc`, and is therefore TypeScript 7
compatible today. For a greenfield repo this size it is a defensible choice and
would let you take TS 7. What you give up: `eslint-plugin-react-hooks`' exact
semantics, the ability to write a custom rule, and the long tail of ecosystem
plugins. Not taken.

## 2. Deviations applied during scaffolding

Seven, all forced by what the registry actually ships today. Each is worth
knowing before someone "corrects" it back.

| #   | Plan said                                  | Repo has                                                                        | Why                                                                                                                                                                                                     |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm@10.15.0`                             | `pnpm@11.1.2`                                                                   | Matches the installed toolchain                                                                                                                                                                         |
| 2   | `onlyBuiltDependencies:` list              | `allowBuilds:` map                                                              | pnpm 11 renamed the setting; the old key makes pnpm rewrite the file and then fail every command                                                                                                        |
| 3   | `vitest: ^3.2.0`                           | `vitest: ^4.1.0`                                                                | `@vitejs/plugin-react@6` needs Vite 8; Vitest 3 caps Vite at 7. Vitest 4 spans `^6 \|\| ^7 \|\| ^8`                                                                                                     |
| 4   | ESLint 9                                   | ESLint 10.8.1                                                                   | The 9.x line is published deprecated; `typescript-eslint@8.67` and `eslint-plugin-react-hooks@7` both declare `^10.0.0`                                                                                 |
| 5   | `reactHooks.configs["recommended-latest"]` | `reactHooks.configs.flat["recommended-latest"]`                                 | In v7 the top-level key is still eslintrc-shaped (`plugins: ["react-hooks"]`) and ESLint 10 rejects it                                                                                                  |
| 6   | core `outDir: "dist"`                      | core `outDir: ".tsbuild"`                                                       | `tsdown` owns `dist/` and cleans it. `tsc -b` writes type-check output next door; apps resolve core through `paths` → project references, so `pnpm typecheck` works on a fresh clone with nothing built |
| 7   | `exports` → `index.js` / `index.d.ts`      | `index.mjs` / `index.d.mts` + `.cjs` / `.d.cts`, split under `import`/`require` | The filenames tsdown actually emits. Verified: `attw` and `publint` both clean                                                                                                                          |

Deviation 8 is the one that would have quietly wasted the exercise. With the
default resolver, `apps/web/src/App.tsx → @breinstein/ogcapi-processes-core` came back
unresolved, so dependency-cruiser never walked _into_ `packages/core` — and the
`core-is-framework-free` rule, whose entire job is catching transitive leakage,
had nothing to inspect. `tsconfig.base.json` now maps the package name to
`packages/core/src/index.ts`, which also means `pnpm boundaries` and
`pnpm typecheck` both work on a clean checkout with no `dist/` built.

All five rules were tested by deliberately breaking them: a direct `react`
import in core, an undeclared `react` import two modules deep, a
`core → apps/web` import, and a `maplibre-gl` import outside `apps/web/src/map`.
Each one fails the build.

Deviation 6 is the other with a rationale worth restating: workspace tsconfigs
include `test/` as well as `src/`, so `pnpm typecheck` covers the tests and
`typescript-eslint`'s project service can type-check every linted file without
an `allowDefaultProject` escape hatch. Root-level config files and `e2e/` are
the exception — they sit in `tseslint.configs.disableTypeChecked`.

## 2b. Runtime targets for `packages/core`

The published package is **ESM only, Node >=18, modern browsers (ES2022)**, and
contains no DOM-specific and no Node-specific API. No CJS build, no `main`, no
`browser` field. Enforced rather than documented:

- `lib: ["ES2022", "DOM"]` with **no `@types/node`**. The DOM lib supplies types
  for `fetch`, `Response`, `Headers`, `Blob`, `AbortController` and `URL`, all
  native in Node 18+. Adding `@types/node` is what would let `Buffer` and
  `node:` imports type-check silently.
- `no-restricted-globals` and `no-restricted-imports` on `packages/core/src/**`,
  at `error`. Note the built-ins are matched as exact `paths`, not `patterns`:
  ESLint's pattern matching is gitignore-flavoured, so a bare `"http"` pattern
  also matches `./http/fetch.ts` and fired on our own source.
- A `core-is-runtime-neutral` dependency-cruiser rule for Node built-ins reached
  transitively.
- `pnpm test:smoke` — packs the package, installs the tarball into a throwaway
  directory outside the repo, then (a) imports it on bare Node and constructs a
  client with a stub fetch, and (b) bundles it with `esbuild --platform=browser
--target=es2022`. Also runs `publint` and `attw` against the tarball.

The two smoke lanes are complementary, and both were verified by deliberately
breaking them: a `node:buffer` import passes the Node lane and fails the browser
bundle; a `document` reference passes the browser bundle and fails the Node lane.

`attw` runs with `--profile esm-only`. That is not a waiver: `node10 resolution
failed` and `CJS resolves to ESM` are the _intended_ consequences of publishing
no CJS build and no `main`. Every other attw rule still applies.

`tsdown` is configured `platform: "neutral"` with `fixedExtension: false`, which
is both semantically right for this package and what produces plain
`dist/index.js` / `dist/index.d.ts` instead of `.mjs` / `.cjs`.

## 3. Order of work — done

1. `git init`, root `package.json`, `pnpm-workspace.yaml`, `.npmrc`, MIT `LICENSE`. ✅
2. `tsconfig.base.json` + three workspace tsconfigs wired with project references. ✅
3. ESLint, Prettier, dependency-cruiser, Vitest — one trivial passing test per
   workspace, so `pnpm verify` is green from commit one. ✅
4. The `verify` GitHub Actions workflow (plus `interop` and `publish`). ✅
5. `infra/compose/pygeoapi.yml` and both pygeoapi configs. ✅
6. `THIRD_PARTY.md` skeleton. ✅
7. `packages/core` skeleton with `tsdown.config.ts` and a publish dry run. ✅

Step 7 mattered more than it looked — and duly caught deviation 7. Discovering
an `exports`/`.d.ts` problem in late October, with a Barcelona date fixed, is
the avoidable version of that risk.

Still to do by hand, off-repo:

- Publish `@breinstein/ogcapi-processes-core@0.1.0` once with a token, then configure
  the npm Trusted Publisher rule against `.github/workflows/publish.yml`.
  Trusted publishing can only be configured on a package that already exists.
- Confirm `repository.url` in `packages/core/package.json` matches the GitHub
  repo exactly, **including case**. A mismatch is the most common cause of a 404
  on the first trusted-publish attempt.
- Fill in the live topic #1 / #2 endpoints under `packages/core/test/interop/`.

## 4. What not to add

- Turborepo or Nx — three workspaces, no caching problem to solve.
- Changesets — one published package. A tag plus a hand-written `CHANGELOG.md` is enough.
- Storybook, a component library, a CSS framework beyond plain CSS or CSS modules.
- Zustand/Redux (already a non-goal in the architecture document).
- A custom ESLint plugin for boundaries — `no-restricted-imports` plus dependency-cruiser covers it.
- Semantic-release, commitlint, conventional-commit tooling.
- A second linter "for speed". The repo is small; ESLint takes seconds.
