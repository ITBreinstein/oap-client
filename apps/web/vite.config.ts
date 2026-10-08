import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * `THIRD-PARTY-LICENSES.md` beside the bundle: every bundled package's licence,
 * and the licences of the packages it depends on (review T9).
 *
 * Minifying drops the licence comments from the code, and maplibre-gl's BSD-3
 * licence asks for its notice to go with any binary redistribution. Vite's own
 * `build.license` writes the licences of the packages it bundled, but sees one
 * package where maplibre-gl ships a build that already holds its dependencies:
 * pbf and vector-tile (BSD-3), tiny-sdf and unitbezier (BSD-2), earcut and
 * more, none of which its own LICENSE.txt covers. So the dependencies of every
 * bundled package are listed too. One that is only types, and never bundled,
 * costs a few lines in a text file; a notice left out is a licence broken.
 */

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly repository?: string | { readonly url?: string };
  readonly dependencies?: Record<string, string>;
}

/** Where to read a licence the package does not carry. */
function repositoryOf(manifest: Manifest): string | undefined {
  const { repository } = manifest;
  const url = typeof repository === "string" ? repository : repository?.url;
  if (url === undefined) return undefined;
  // npm's shorthand, `owner/repo`, is GitHub.
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

/** The package directory a module id lives in, or undefined for our own code. */
function packageDirOf(id: string): string | undefined {
  const path = id.split("?")[0] ?? id;
  const at = path.lastIndexOf("/node_modules/");
  if (at === -1) return undefined;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : rest[0];
  return name === undefined ? undefined : path.slice(0, at + "/node_modules/".length) + name;
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
}

/**
 * A dependency of the package in `dir`: nested under it, or beside it, as npm
 * and pnpm lay them out. Beside its *real* path: pnpm links each package from
 * a store directory that holds that package's own dependencies.
 */
function dependencyDir(dir: string, name: string): string | undefined {
  const real = realpathSync(dir);
  const parent = real.slice(0, real.lastIndexOf("/node_modules/") + "/node_modules/".length);
  for (const candidate of [join(real, "node_modules", name), join(parent, name)]) {
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
  }
  return undefined;
}

function licenceText(dir: string): string | undefined {
  const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry));
  return file === undefined ? undefined : readFileSync(join(dir, file), "utf8").trim();
}

function thirdPartyLicences(fileName: string): Plugin {
  return {
    name: "third-party-licences",
    apply: "build",
    generateBundle(_options, bundle) {
      const found = new Map<string, { manifest: Manifest; dir: string }>();
      const visit = (dir: string): void => {
        const manifest = readManifest(dir);
        const key = `${manifest.name}@${manifest.version}`;
        if (found.has(key)) return;
        found.set(key, { manifest, dir });
        for (const name of Object.keys(manifest.dependencies ?? {})) {
          const next = dependencyDir(dir, name);
          if (next !== undefined) visit(next);
        }
      };
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of output.moduleIds) {
          const dir = packageDirOf(id);
          if (dir !== undefined) visit(dir);
        }
      }

      const sections = [...found.values()]
        .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
        .map(({ manifest, dir }) => {
          const heading = `## ${manifest.name} ${manifest.version} (${manifest.license ?? "no licence declared"})`;
          const text = licenceText(dir);
          if (text !== undefined) return `${heading}\n\n\`\`\`\n${text}\n\`\`\``;
          const repository = repositoryOf(manifest);
          return `${heading}\n\nThe package carries no licence file${repository === undefined ? "." : `; its licence is in ${repository}.`}`;
        });
      this.emitFile({
        type: "asset",
        fileName,
        source: [
          "# Third-party licences",
          "",
          "This build contains code from the packages below, each under the licence shown.",
          "",
          ...sections.flatMap((section) => [section, ""]),
        ].join("\n"),
      });
    },
  };
}

export default defineConfig({
  // Every bundled package's licence, beside the bundle and deployed with it:
  // minifying drops the licence comments that maplibre-gl's BSD-3 licence
  // asks to travel with a binary (review T9).
  plugins: [react(), thirdPartyLicences("THIRD-PARTY-LICENSES.md")],
  // MapLibre's worker is a module worker; see src/map/MapView.tsx.
  worker: { format: "es" },
  resolve: {
    alias: {
      // Use core's source in dev and test; the published entry is dist/.
      "@breinstein/oap-client": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "web",
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    exclude: [...configDefaults.exclude, "**/.tsbuild/**"],
  },
});
