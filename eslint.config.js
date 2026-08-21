import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.tsbuild/**",
      "**/node_modules/**",
      "**/.playwright/**",
      "**/coverage/**",
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
    files: ["*.config.{js,ts}", "*.cjs", "**/*.config.{js,ts}", "e2e/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },

  // §5, rule 1: the core is framework-free.
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react/*"], message: "core must not depend on React" },
            { group: ["maplibre-gl", "terra-draw*"], message: "core must not depend on the map" },
            { group: ["**/apps/**"], message: "core must not import application code" },
          ],
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
