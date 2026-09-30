/**
 * What a relay or a web build for the browser lane was made from, as one
 * short hash: the source files, the configuration the lane gives it, and the
 * lockfile. `playwright.config.ts` hands it to the servers it starts, and
 * `global-setup.ts` refuses a server on the lane's ports that reports another
 * (review T4). A hash of the files rather than a commit, so a change not yet
 * committed counts too.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function files(path: string): string[] {
  const absolute = join(ROOT, path);
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

function fingerprint(paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of paths.flatMap(files).sort()) {
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(join(ROOT, file)))
      .update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** The relay: its sources, its manifest, and the lane's relay config. */
export function relayBuild(): string {
  return fingerprint([
    "apps/relay/src",
    "apps/relay/package.json",
    "e2e/relay.json",
    "pnpm-lock.yaml",
  ]);
}

/** The web build: its sources, the core it bundles, and the config.json it is served with. */
export function webBuild(): string {
  return fingerprint([
    "apps/web/src",
    "apps/web/index.html",
    "apps/web/package.json",
    "apps/web/vite.config.ts",
    "packages/core/src",
    "e2e/config.relay.json",
    "pnpm-lock.yaml",
  ]);
}
