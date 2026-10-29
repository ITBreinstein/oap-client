/**
 * The token file, read as text: every style and theme defines every token,
 * shapes and colours stay in their own blocks, the pairs that carry text or
 * edges have the contrast they need, and no other stylesheet names a colour
 * of its own (ADR 0002).
 */

import { describe, expect, it } from "vitest";
import structure from "../../src/styles.css?raw";
import tokensCss from "../../src/styles/tokens.css?raw";

// Each style's own sheet, and Instrument's backdrop, found by name: deleting a
// losing style needs no edit here.
const styleSheets: Record<string, string> = import.meta.glob(
  ["../../src/styles/style-*.css", "../../src/styles/backdrop.css"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

const STYLES = ["instrument"] as const;
const THEMES = ["light", "dark"] as const;

const SHAPE_TOKENS = [
  "--font-ui",
  "--font-mono",
  "--font-heading",
  "--heading-weight",
  "--heading-tracking",
  "--label-font",
  "--label-size",
  "--label-weight",
  "--label-transform",
  "--label-tracking",
  "--r-card",
  "--r-item",
  "--r-control",
  "--r-tag",
];

/** Outermost first: a card holds items, an item controls, a control tags. */
const RADII = ["--r-card", "--r-item", "--r-control", "--r-tag"];

const COLOUR_TOKENS = [
  "--page",
  "--surface",
  "--surface-2",
  "--surface-hover",
  "--field",
  "--rail",
  "--rail-hover",
  "--text",
  "--text-strong",
  "--text-secondary",
  "--muted",
  "--ident",
  "--label-color",
  "--line",
  "--line-strong",
  "--line-mid",
  "--line-label",
  "--field-border",
  "--accent",
  "--accent-hover",
  "--accent-text",
  "--accent-ink",
  "--selected-bg",
  "--selected-text",
  "--selected-line",
  "--focus",
  "--need-area-fg",
  "--need-area-bg",
  "--need-data-fg",
  "--need-data-bg",
  "--need-values-fg",
  "--need-values-bg",
  "--result-fg",
  "--result-surface",
  "--result-line",
  "--success",
  "--success-surface",
  "--warning",
  "--error",
  "--error-surface",
  "--notice-surface",
  "--notice-line",
  "--overlay",
  "--shadow-card",
  "--shadow-panel",
  "--shadow-popover",
  "--backdrop-ground",
  "--backdrop-line-1",
  "--backdrop-line-2",
  "--backdrop-water",
  "--backdrop-park",
  "--backdrop-veil",
  "--backdrop-veil-list",
  "--backdrop-veil-sheet",
  "--backdrop-scrim",
];

/** Top-level rules of a stylesheet, `@media` blocks and comments left out. */
function rules(css: string): { selectors: string[]; body: string }[] {
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
    .replace(/@import[^;]*;/g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((selector) => selector.trim()),
    body: match[2] ?? "",
  }));
}

function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

const tokenRules = rules(tokensCss);

function block(selector: string): Map<string, string> {
  const rule = tokenRules.find((candidate) => candidate.selectors.includes(selector));
  if (rule === undefined) throw new Error(`no block for ${selector}`);
  return declarations(rule.body);
}

/** Every token for one style and theme, `var(--x)` resolved. */
function tokensOf(style: string, theme: string): Map<string, string> {
  const all = new Map([
    ...block(`[data-style="${style}"]`),
    ...block(`[data-style="${style}"][data-theme="${theme}"]`),
  ]);
  for (const [name, value] of all) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    if (ref !== undefined) all.set(name, all.get(ref) ?? value);
  }
  return all;
}

type Rgba = readonly [number, number, number, number];

function parseColour(value: string): Rgba | undefined {
  if (value === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex !== undefined) {
    const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16);
    return [channel(0), channel(2), channel(4), 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+)%)?\)$/.exec(value);
  if (rgb === null) return undefined;
  return [
    Number(rgb[1]),
    Number(rgb[2]),
    Number(rgb[3]),
    rgb[4] === undefined ? 1 : Number(rgb[4]) / 100,
  ];
}

/** `top` laid over the opaque `base`. */
function over(top: Rgba, base: Rgba): Rgba {
  const mix = (i: 0 | 1 | 2) => top[i] * top[3] + base[i] * (1 - top[3]);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Foreground, background, the least contrast they need. Backgrounds may be see-through: laid over --surface. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["--text", "--page", 4.5],
  ["--text", "--surface", 4.5],
  ["--text", "--surface-hover", 4.5],
  ["--text", "--field", 4.5],
  ["--text-secondary", "--surface", 4.5],
  ["--muted", "--surface", 4.5],
  ["--muted", "--page", 4.5],
  ["--ident", "--surface", 4.5],
  ["--label-color", "--surface", 4.5],
  ["--accent-text", "--accent", 4.5],
  ["--accent-text", "--accent-hover", 4.5],
  ["--accent-ink", "--surface", 4.5],
  ["--accent-ink", "--page", 4.5],
  ["--selected-text", "--selected-bg", 4.5],
  ["--need-area-fg", "--need-area-bg", 4.5],
  ["--need-data-fg", "--need-data-bg", 4.5],
  ["--need-values-fg", "--need-values-bg", 4.5],
  ["--result-fg", "--result-surface", 4.5],
  ["--text", "--result-surface", 4.5],
  ["--success", "--surface", 4.5],
  ["--success", "--success-surface", 4.5],
  ["--warning", "--surface", 4.5],
  ["--error", "--surface", 4.5],
  ["--error", "--error-surface", 4.5],
  ["--text", "--notice-surface", 4.5],
  ["--text", "--error-surface", 4.5],
  ["--field-border", "--field", 3],
  ["--field-border", "--surface", 3],
  ["--focus", "--surface", 3],
  ["--focus", "--page", 3],
  ["--selected-line", "--surface", 3],
];

describe("tokens.css", () => {
  for (const style of STYLES) {
    it(`${style}: the shape block has every shape token and no colour`, () => {
      const shape = block(`[data-style="${style}"]`);
      for (const token of SHAPE_TOKENS) expect(shape.has(token), token).toBe(true);
      for (const value of shape.values()) expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    });

    for (const theme of THEMES) {
      it(`${style} ${theme}: every colour token, and no shape`, () => {
        const colours = block(`[data-style="${style}"][data-theme="${theme}"]`);
        for (const token of COLOUR_TOKENS) expect(colours.has(token), token).toBe(true);
        for (const token of colours.keys()) {
          expect(SHAPE_TOKENS.includes(token), `${token} is a shape`).toBe(false);
        }
      });

      it(`${style} ${theme}: text at least 4.5:1, edges and focus at least 3:1`, () => {
        const tokens = tokensOf(style, theme);
        const colour = (name: string): Rgba => {
          const parsed = parseColour(tokens.get(name) ?? "");
          if (parsed === undefined)
            throw new Error(`${name} is no colour: ${String(tokens.get(name))}`);
          return parsed;
        };
        const surface = colour("--surface");
        const failures = PAIRS.flatMap(([fg, bg, least]) => {
          const ratio = contrast(over(colour(fg), surface), over(colour(bg), surface));
          return ratio >= least ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${String(least)}`];
        });
        expect(failures).toEqual([]);
      });
    }

    // A version on trial may override shapes in a block of its own (ADR 0002).
    const variants = tokenRules.filter((rule) =>
      rule.selectors.some((selector) =>
        selector.startsWith(`[data-style="${style}"][data-variant=`),
      ),
    );

    it(`${style}: a version's own block holds shapes only, and no colour`, () => {
      for (const variant of variants) {
        for (const [token, value] of declarations(variant.body)) {
          expect(SHAPE_TOKENS.includes(token), `${token} is no shape`).toBe(true);
          expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
        }
      }
    });

    it(`${style}: corners never grow from card to item to control to tag, in every version`, () => {
      const shape = block(`[data-style="${style}"]`);
      const versions = [
        shape,
        ...variants.map((variant) => new Map([...shape, ...declarations(variant.body)])),
      ];
      for (const shapes of versions) {
        const radii = RADII.map((token) => parseFloat(shapes.get(token) ?? ""));
        for (const radius of radii) expect(Number.isFinite(radius)).toBe(true);
        expect(radii).toEqual([...radii].sort((a, b) => b - a));
      }
    });
  }
});

describe("the other stylesheets", () => {
  // The map's own colours (map/basemap.ts) are the one exception: the legend
  // swatches mirror them, the same on a light and a dark page.
  const sheets: [string, string][] = [["styles.css", structure], ...Object.entries(styleSheets)];

  it.each(sheets)("%s names no colour of its own", (_name, text) => {
    const checked = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/[^{}]*swatch[^{}]*\{[^{}]*\}/g, "");
    const stray = [...checked.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map(
      (match) => match[0],
    );
    expect(stray).toEqual([]);
  });
});
