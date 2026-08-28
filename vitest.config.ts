import { configDefaults, defineConfig } from "vitest/config";

// tsc -b writes type-check output to .tsbuild/; it is not a test source.
// contract/ needs the pinned pygeoapi, and interop/ needs a live server —
// ZOO on :5090 via ./infra/zoo/zoo.sh, or a third-party endpoint. Both have
// their own config so that `pnpm test` stays runnable with neither.
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
          exclude: [...exclude, "test/interop/**", "test/contract/**"],
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
