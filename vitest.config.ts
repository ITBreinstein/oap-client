import { configDefaults, defineConfig } from "vitest/config";

// tsc -b writes type-check output to .tsbuild/; it is not a test source.
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
          exclude: [...exclude, "test/interop/**"],
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
