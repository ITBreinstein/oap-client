/**
 * The page's appearance as React state: the style and theme chosen
 * (`appearance.ts`), the theme that is actually on, and the two setters the
 * Appearance control calls.
 *
 * The system's light or dark setting is read with `useSyncExternalStore`, so
 * a change in the operating system's setting re-renders the page while the
 * preference is "Follow system", with no effect of our own keeping a copy.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
  // keeps `<html>` in step with every change after it.
  useEffect(() => {
    applyAppearance(document.documentElement, appearance, resolvedTheme);
  }, [appearance, resolvedTheme]);

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
