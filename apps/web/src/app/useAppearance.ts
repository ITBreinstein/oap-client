/**
 * The page's appearance as React state: the style and theme chosen
 * (`appearance.ts`), the theme that is actually on, and the two setters the
 * Appearance control calls.
 *
 * The system's light or dark setting is read with `useSyncExternalStore`, so
 * a change in the operating system's setting re-renders the page while the
 * preference is "Follow system", with no effect of our own keeping a copy.
 *
 * A change of theme, from the control or from the system, goes through
 * `switchTheme`: a short crossfade where the browser can draw one.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  applyAppearance,
  browserStorage,
  DARK_QUERY,
  resolveTheme,
  saveAppearanceChoice,
  startingAppearance,
  systemPrefersDark,
  type Appearance,
  type ResolvedTheme,
  type StyleName,
  type ThemePreference,
} from "./appearance.js";
import {
  backdropReady,
  backdropShown,
  prefetchOtherBackdrop,
  saveDataRequested,
  shouldPrefetch,
} from "./backdrop.js";
import { skipThemeFade, switchTheme } from "./theme-switch.js";

/** Listen for the system's dark setting changing. A no-op where `matchMedia` is missing. */
function subscribeToSystemTheme(onChange: () => void): () => void {
  let query: MediaQueryList;
  try {
    query = globalThis.matchMedia(DARK_QUERY);
  } catch {
    return () => undefined;
  }
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

export interface AppearanceView {
  readonly appearance: Appearance;
  /** The theme on screen: the preference, with "system" resolved. */
  readonly resolvedTheme: ResolvedTheme;
  readonly setStyle: (style: StyleName) => void;
  readonly setTheme: (theme: ThemePreference) => void;
}

export function useAppearance(initial?: Appearance): AppearanceView {
  const [appearance, setAppearance] = useState<Appearance>(() => initial ?? startingAppearance());
  const systemDark = useSyncExternalStore(
    subscribeToSystemTheme,
    systemPrefersDark,
    // Rendered on a server there is no system to ask: light, as the defaults are.
    () => false,
  );
  const resolvedTheme = resolveTheme(appearance.theme, systemDark);

  // `main.tsx` wrote the starting appearance before the first render; this
  // keeps `<html>` in step with every change after it. Writing always takes
  // the latest choice, so a switch that lands late can't undo a newer one.
  const latest = useRef({ appearance, resolvedTheme });
  useEffect(() => {
    latest.current = { appearance, resolvedTheme };
    const root = document.documentElement;
    const apply = () => {
      applyAppearance(root, latest.current.appearance, latest.current.resolvedTheme);
    };
    if (root.dataset["theme"] === resolvedTheme) {
      skipThemeFade();
      apply();
      return undefined;
    }
    // On the start screen, a fade waits for the backdrop it ends on.
    const ready = backdropShown() ? () => backdropReady(resolvedTheme) : undefined;
    return switchTheme(apply, ready);
  }, [appearance, resolvedTheme]);

  // The other theme's backdrop, fetched when idle.
  useEffect(() => {
    if (!shouldPrefetch(saveDataRequested())) return undefined;
    return prefetchOtherBackdrop(resolvedTheme);
  }, [resolvedTheme]);

  const setStyle = useCallback((style: StyleName) => {
    setAppearance((current) => ({ ...current, style }));
    saveAppearanceChoice(browserStorage(), { style });
  }, []);

  const setTheme = useCallback((theme: ThemePreference) => {
    setAppearance((current) => ({ ...current, theme }));
    saveAppearanceChoice(browserStorage(), { theme });
  }, []);

  return { appearance, resolvedTheme, setStyle, setTheme };
}
