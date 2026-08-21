// Consumer smoke tests. These deliberately do NOT run inside the pnpm
// workspace: the package is packed, installed from the tarball into a throwaway
// directory outside the repo, and consumed the way a real dependant would.
//
//   node  — imports the public entry and constructs a client with a stub fetch
//   web   — bundles for the browser; a Node built-in in the published output is
//           an unresolvable import and fails the bundle
//
// Also runs publint and attw against the tarball itself, which is what catches
// a broken exports map or types that resolve for us but not for a consumer.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const smokeDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(smokeDir, "..");
const coreDir = join(repoRoot, "packages", "core");
const PKG = "@breinstein/ogcapi-processes-core";

const run = (cmd, args, cwd, quiet = true) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });

const step = (name) => process.stdout.write(`\n▸ ${name}\n`);
const workspaces = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "oap-smoke-"));
  workspaces.push(dir);
  return dir;
};

try {
  step("build + pack");
  run("pnpm", ["--filter", PKG, "build"], repoRoot);
  const packDir = scratch();
  const packed = run("npm", ["pack", "--pack-destination", packDir], coreDir)
    .trim()
    .split("\n")
    .pop();
  const tarball = join(packDir, packed);
  console.log(`  ${packed}`);

  step("package correctness (against the tarball)");
  run("pnpm", ["exec", "publint", "run", tarball, "--strict"], repoRoot);
  console.log("  publint clean");
  // --profile esm-only encodes the decision rather than waiving a failure:
  // node10 resolution and "CJS resolves to ESM" are the *intended* consequences
  // of shipping no CJS build and no `main`. Every other attw rule still applies.
  run("pnpm", ["exec", "attw", "--profile", "esm-only", tarball], repoRoot);
  console.log("  attw clean (esm-only profile)");

  step("node consumer (installed from tarball)");
  const nodeDir = scratch();
  writeFileSync(
    join(nodeDir, "package.json"),
    JSON.stringify({ name: "smoke-node", private: true, type: "module" }, null, 2),
  );
  run("npm", ["install", "--no-audit", "--no-fund", tarball], nodeDir);
  copyFileSync(join(smokeDir, "node", "consumer.mjs"), join(nodeDir, "consumer.mjs"));
  process.stdout.write(run("node", ["consumer.mjs"], nodeDir));

  step("browser bundle (installed from tarball)");
  const webDir = scratch();
  writeFileSync(
    join(webDir, "package.json"),
    JSON.stringify({ name: "smoke-web", private: true, type: "module" }, null, 2),
  );
  run("npm", ["install", "--no-audit", "--no-fund", tarball], webDir);
  copyFileSync(join(smokeDir, "browser", "consumer.mjs"), join(webDir, "consumer.mjs"));
  run(
    join(repoRoot, "node_modules", ".bin", "esbuild"),
    [
      "consumer.mjs",
      "--bundle",
      "--format=esm",
      "--target=es2022",
      "--platform=browser",
      "--outfile=bundle.js",
    ],
    webDir,
  );
  console.log("  bundled for browser (es2022), no Node built-ins reached");

  console.log("\n✔ smoke tests passed\n");
} catch (error) {
  console.error(`\n✖ smoke tests failed\n`);
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  process.exitCode = 1;
} finally {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
}
