import { configDefaults, defineConfig } from "vitest/config";

// tsc -b writes type-check output to .tsbuild/; it is not a test source.
// contract/ needs the pinned pygeoapi, interop/ needs a live server — ZOO on
// :5090 via ./infra/zoo/zoo.sh, or a third-party endpoint — and watch/ needs a
// ZOO it is allowed to deplete on purpose. Each has its own config so that
// `pnpm test` stays runnable with none of them.
const exclude = [...configDefaults.exclude, "**/.tsbuild/**"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "packages/core",
          environment: "node",
          setupFiles: ["./test/msw.setup.ts"],
          exclude: [...exclude, "test/interop/**", "test/contract/**", "test/watch/**"],
        },
      },
      // Picks up apps/web/vite.config.ts (React plugin + core alias).
      "apps/web",
      {
        test: { name: "relay", root: "apps/relay", environment: "node", exclude },
      },
    ],
  },
});
