import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Serves the core's captured fixtures at `/fixtures` while developing.
 *
 * Without this the only way to point the interface at a recorded process
 * description is Vite's `/@fs/` route, which carries an absolute path from
 * whoever's machine it was — not something to paste into a public repository or
 * hand to a colleague. Development only: `apply: "serve"` keeps it out of the
 * build, where these files do not exist.
 */
function serveCapturedFixtures(): Plugin {
  const root = fileURLToPath(new URL("../../packages/core/test/fixtures/", import.meta.url));

  return {
    name: "serve-captured-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/fixtures", (request, response, next) => {
        const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
        const file = resolve(root, `.${path}`);

        // `..` in the URL would otherwise reach anywhere on the machine.
        if (!file.startsWith(root)) {
          response.statusCode = 403;
          response.end("Outside the fixture directory");
          return;
        }

        readFile(file)
          .then((body) => {
            response.setHeader("Content-Type", "application/json");
            response.end(body);
          })
          .catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveCapturedFixtures()],
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
