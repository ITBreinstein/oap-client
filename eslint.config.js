import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// The core is framework-free (§5, rule 1).
const frameworkImports = [
  { group: ["react", "react-dom", "react/*"], message: "core must not depend on React" },
  { group: ["maplibre-gl", "terra-draw*"], message: "core must not depend on the map" },
  { group: ["**/apps/**"], message: "core must not import application code" },
];

// The core is also runtime-neutral: ESM, Node >=18 and modern browsers, with no
// API that exists on only one of them. See "Supported environments" in
// packages/core/README.md.
const runtimeNeutralMessage =
  "core is runtime-neutral: no Node built-ins (inject a dependency instead)";

// `patterns` uses gitignore semantics, where a bare "http" also matches
// ./http/fetch.js. Built-ins are matched by exact specifier instead.
const nodeOnlyImportPatterns = [{ group: ["node:*"], message: runtimeNeutralMessage }];

const nodeOnlyImportPaths = [
  "fs",
  "fs/promises",
  "path",
  "path/posix",
  "path/win32",
  "http",
  "https",
  "stream",
  "stream/promises",
  "stream/web",
  "buffer",
  "url",
  "crypto",
].map((name) => ({ name, message: runtimeNeutralMessage }));

// Globals that betray a single runtime. fetch/Response/Headers/Blob/
// AbortController/URL are deliberately absent — they exist in both.
const singleRuntimeGlobals = [
  { name: "window", message: "core is runtime-neutral: no DOM globals" },
  { name: "document", message: "core is runtime-neutral: no DOM globals" },
  { name: "localStorage", message: "core is runtime-neutral: no DOM globals" },
  { name: "sessionStorage", message: "core is runtime-neutral: no DOM globals" },
  { name: "navigator", message: "core is runtime-neutral: no DOM globals" },
  { name: "location", message: "core is runtime-neutral: no DOM globals" },
  { name: "Buffer", message: "core is runtime-neutral: no Node globals (use Uint8Array)" },
  { name: "process", message: "core is runtime-neutral: no Node globals (inject config instead)" },
  { name: "__dirname", message: "core is runtime-neutral: no Node globals" },
  { name: "__filename", message: "core is runtime-neutral: no Node globals" },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.tsbuild/**",
      "**/node_modules/**",
      "**/.playwright/**",
      // A pinned third-party checkout, cloned by infra/zoo/zoo.sh as a build
      // input. Not our source, and never edited in place — see infra/zoo/README.md.
      "infra/zoo/.checkout/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },

  // Config files and E2E specs live outside the composite projects.
  {
    files: ["*.config.{js,ts}", "*.cjs", "**/*.config.{js,ts}", "e2e/**/*.ts", "smoke/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },

  // The smoke consumers are plain .mjs, so no-undef applies and nothing declares
  // their globals. They run on Node against the packed tarball.
  {
    files: ["smoke/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        globalThis: "readonly",
        URL: "readonly",
        Response: "readonly",
      },
    },
  },

  // Core tests may not reach for a framework either, but they do run on Node.
  {
    files: ["packages/core/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: frameworkImports }] },
  },

  // Published core source: framework-free *and* runtime-neutral. A later block
  // replaces an earlier rule config outright, so the framework patterns repeat.
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeOnlyImportPaths,
          patterns: [...frameworkImports, ...nodeOnlyImportPatterns],
        },
      ],
      "no-restricted-globals": ["error", ...singleRuntimeGlobals],
    },
  },

  // The HTTP boundary lives in src/http/ and nothing above it may bypass it.
  // A later block replaces an earlier rule config outright, so the runtime
  // globals from the block above are repeated here.
  {
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/http/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...singleRuntimeGlobals,
        {
          name: "fetch",
          message: "only packages/core/src/http may call fetch: go through send()",
        },
      ],
      // no-restricted-globals only sees a bare identifier, and `globalThis.fetch`
      // is exactly how you would sidestep it.
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='globalThis'][property.name='fetch']",
          message: "only packages/core/src/http may call fetch: go through send()",
        },
      ],
    },
  },

  // §5, most important rule: only the map binding touches MapLibre imperatively.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/map/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["maplibre-gl", "terra-draw*"],
              message: "only apps/web/src/map may import the map libraries",
            },
          ],
        },
      ],
    },
  },

  { files: ["apps/web/**/*.{ts,tsx}"], ...reactHooks.configs.flat["recommended-latest"] },
  prettier,
);
