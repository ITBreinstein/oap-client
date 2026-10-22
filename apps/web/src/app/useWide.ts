/**
 * Whether the window is wide enough for the form beside the map: the same
 * 52rem the stylesheets switch at. Read from `matchMedia`, and followed as
 * the window changes.
 */

import { useSyncExternalStore } from "react";

const WIDE = "(min-width: 52rem)";

function query(): MediaQueryList | undefined {
  try {
    return typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? undefined
      : window.matchMedia(WIDE);
  } catch {
    return undefined;
  }
}

function subscribe(changed: () => void): () => void {
  const list = query();
  list?.addEventListener("change", changed);
  return () => {
    list?.removeEventListener("change", changed);
  };
}

export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? true,
    () => true,
  );
}
