/**
 * How the page looks: a **style** and a **theme**, kept apart.
 *
 * - The style is shape, type and layout: corner radii, borders or shadows,
 *   fonts, label treatment, where panels dock. Three are on trial
 *   (`docs/adr/0002-switchable-styles.md`); two will be deleted.
 * - The theme is colour only, light or dark. It never changes a radius or a
 *   layout.
 *
 * Both are written to `<html>` as `data-style` and `data-theme`, which is all
 * the stylesheets read (`styles/tokens.css`). Nothing else in the page asks
 * which style is on, apart from the app's frame (`AppFrame`).
 *
 * Where the choice comes from, first match wins: the address
 * (`?style=precise&theme=dark`), then what this browser saved, then the
 * defaults. An address never overwrites the saved choice, so opening a shared
 * link does not change anyone's own setting. Anything unrecognised, from
 * either source, is ignored silently: neither is ours to trust.
 */

export const STYLE_NAMES = ["hybrid", "instrument", "precise"] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ResolvedTheme = "light" | "dark";

export interface Appearance {
  readonly style: StyleName;
  readonly theme: ThemePreference;
}

export const DEFAULT_APPEARANCE: Appearance = { style: "hybrid", theme: "system" };

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

/** What a saved value holds that can be used, member by member. */
function fromStored(stored: unknown): Partial<Appearance> {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const style: unknown = Reflect.get(stored, "style");
  const theme: unknown = Reflect.get(stored, "theme");
  return {
    ...(isStyleName(style) ? { style } : {}),
    ...(isThemePreference(theme) ? { theme } : {}),
  };
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
 * The appearance to start with: the address first, then the saved value,
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
 * Save one choice the user made, on top of what was saved before. Only the
 * member they changed is written: a style or theme that came from the address
 * stays out of storage. Never throws; a choice that cannot be saved still
 * applies to this visit.
 */
export function saveAppearanceChoice(
  storage: AppearanceStorage | undefined,
  choice: Partial<Appearance>,
): void {
  const saved = { ...DEFAULT_APPEARANCE, ...fromStored(readStoredAppearance(storage)), ...choice };
  try {
    storage?.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ style: saved.style, theme: saved.theme }),
    );
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
  root.dataset["style"] = appearance.style;
  root.dataset["theme"] = resolved;
}
