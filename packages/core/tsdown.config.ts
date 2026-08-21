import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  publint: "ci-only",
  attw: { enabled: "ci-only", profile: "node16", level: "error" },
});
