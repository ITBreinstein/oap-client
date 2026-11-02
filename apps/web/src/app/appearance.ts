/**
 * How the page looks: a **style** and a **theme**, kept apart.
 *
 * - The style is shape, type and layout: corner radii, borders or shadows,
 *   fonts, label treatment, where panels dock. Of the three on trial, one
 *   is left: instrument (`docs/adr/0002-switchable-styles.md`), in its
 *   updated version. The version as it was before the UI/UX review is still
 *   there for comparison, but only by address (`?style=instrument`): the
 *   Appearance menu no longer offers a choice, and none is saved.
 * - The theme is colour only, light or dark. It never changes a radius or a
 *   layout. The visitor chooses it, and this browser keeps the choice.
 *
 * Both are written to `<html>`: `data-style="instrument"` for either
 * version, `data-variant` (`current` or `updated`) for which, and
 * `data-theme`. That is all the stylesheets read (`styles/tokens.css`,
 * `styles/instrument-updated.css`); no component asks.
 *
 * Where the choice comes from, first match wins: the address
 * (`?style=instrument&theme=dark`), then what this browser saved (the theme
 * only), then the defaults. An address never overwrites the saved choice, so
 * opening a shared link does not change anyone's own setting. Anything
 * unrecognised, from either source, is ignored silently: neither is ours to
 * trust.
 */

/** STYLE TRIAL: the two versions of instrument. Only the address picks the earlier one. */
export const STYLE_NAMES = ["instrument", "instrument-updated"] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ResolvedTheme = "light" | "dark";

export interface Appearance {
  readonly style: StyleName;
  readonly theme: ThemePreference;
}

export const DEFAULT_APPEARANCE: Appearance = { style: "instrument-updated", theme: "system" };

/** Where this browser keeps the choice. One key, one small JSON object. */
export const APPEARANCE_STORAGE_KEY = "oap.appearance";

/** The media query a `system` preference follows. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

function isStyleName(value: unknown): value is StyleName {
  return STYLE_NAMES.some((name) => name === value);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((name) => name === value);
}

/**
 * What a saved value holds that can be used: its theme. A style saved while
 * the menu still offered one is ignored, so everyone sees the same version.
 */
function fromStored(stored: unknown): Partial<Appearance> {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const theme: unknown = Reflect.get(stored, "theme");
  return isThemePreference(theme) ? { theme } : {};
}

/** What the address asks for, parameter by parameter. */
function fromSearch(search: string): Partial<Appearance> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }
  const style = params.get("style");
  const theme = params.get("theme");
  return {
    ...(isStyleName(style) ? { style } : {}),
    ...(isThemePreference(theme) ? { theme } : {}),
  };
}

/**
 * The appearance to start with: the address first, then the saved theme,
 * then {@link DEFAULT_APPEARANCE}, each member on its own. `stored` is the
 * parsed saved value, of any shape.
 */
export function parseAppearance(search: string, stored: unknown): Appearance {
  return { ...DEFAULT_APPEARANCE, ...fromStored(stored), ...fromSearch(search) };
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  switch (preference) {
    case "light":
    case "dark":
      return preference;
    case "system":
      return systemPrefersDark ? "dark" : "light";
  }
}

/** The part of `Storage` used here, so a test can hand in one that throws. */
export type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;

/** This page's `localStorage`, or undefined where reading it throws (a sandboxed frame, a blocked site). */
export function browserStorage(): AppearanceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The saved value, parsed, or undefined. Never throws: storage can, in a private window. */
export function readStoredAppearance(storage: AppearanceStorage | undefined): unknown {
  try {
    const text = storage?.getItem(APPEARANCE_STORAGE_KEY);
    if (typeof text !== "string") return undefined;
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Save the theme the user chose. Only the theme: a style that came from the
 * address stays out of storage. Never throws; a choice that cannot be saved
 * still applies to this visit.
 */
export function saveAppearanceChoice(
  storage: AppearanceStorage | undefined,
  choice: { readonly theme: ThemePreference },
): void {
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: choice.theme }));
  } catch {
    // Full, or refused: the page carries on with the choice unsaved.
  }
}

/** The appearance this page starts with: its own address, then this browser's saved choice. */
export function startingAppearance(): Appearance {
  let search = "";
  try {
    search = globalThis.location.search;
  } catch {
    // No location (a worker, a test): the saved choice and the defaults decide.
  }
  return parseAppearance(search, readStoredAppearance(browserStorage()));
}

/** Whether the system asks for dark. False where `matchMedia` is missing (a test's DOM). */
export function systemPrefersDark(): boolean {
  try {
    return globalThis.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Write the appearance onto `<html>`. `color-scheme` follows from
 * `data-theme` in the stylesheet, so native controls (scrollbars, date
 * pickers, `<select>`) match without an inline style, which the site's
 * content security policy would refuse.
 */
export function applyAppearance(
  root: HTMLElement,
  appearance: Appearance,
  resolved: ResolvedTheme,
): void {
  root.dataset["style"] = "instrument";
  root.dataset["variant"] = appearance.style === "instrument-updated" ? "updated" : "current";
  root.dataset["theme"] = resolved;
  // The browser's own bars (a phone's address bar) in the page's colour.
  const page = getComputedStyle(root).getPropertyValue("--page").trim();
  if (page === "") return;
  let meta = root.ownerDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta === null) {
    meta = root.ownerDocument.createElement("meta");
    meta.name = "theme-color";
    root.ownerDocument.head.append(meta);
  }
  meta.content = page;
}
