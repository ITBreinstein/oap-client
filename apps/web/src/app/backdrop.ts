/**
 * The two pictures behind the start screen (`styles/backdrop.css`), seen
 * from the code that switches theme.
 *
 * Imported here, Vite gives each picture the same hashed address as the
 * stylesheet's `url()`, so the browser downloads each one once, whoever asks.
 *
 * - Once the page is loaded and idle, the other theme's picture is fetched at
 *   low priority, into the browser's cache only, so a later switch has it at
 *   hand. Not on a connection that asks to save data.
 * - Before a fade to a theme, its picture is decoded, so the fade ends on the
 *   whole picture (`theme-switch.ts`).
 *
 * Deleting the backdrop deletes this file and its two uses in
 * `useAppearance.ts` (ADR 0002).
 */

import day from "../assets/backdrop/europe-day.webp";
import night from "../assets/backdrop/europe-night.webp";
import type { ResolvedTheme } from "./appearance.js";

export const BACKDROP: Readonly<Record<ResolvedTheme, string>> = { light: day, dark: night };

/** Whether to fetch the other theme's picture ahead of time: not when the connection saves data. */
export function shouldPrefetch(saveData: boolean): boolean {
  return !saveData;
}

/** Whether the connection asks pages to save data (`Save-Data`). False where the browser doesn't say. */
export function saveDataRequested(): boolean {
  try {
    const connection: unknown = Reflect.get(navigator, "connection");
    return typeof connection === "object" && connection !== null
      ? Reflect.get(connection, "saveData") === true
      : false;
  } catch {
    return false;
  }
}

/** Run `task` once the page has loaded and the browser is idle. Returns a cancel. */
function whenIdle(task: () => void): () => void {
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if ("requestIdleCallback" in globalThis) idle = requestIdleCallback(task, { timeout: 5000 });
    else timer = setTimeout(task, 1000);
  };
  if (document.readyState === "complete") schedule();
  else globalThis.addEventListener("load", schedule, { once: true });
  return () => {
    globalThis.removeEventListener("load", schedule);
    if (idle !== undefined) cancelIdleCallback(idle);
    clearTimeout(timer);
  };
}

/** The pictures asked for in this visit: the stylesheet's, and ours. */
const asked = new Set<string>();

/**
 * Fetch the picture of the theme not on screen, once, when the page is idle.
 * The response is read to the end, so it lands in the cache, and dropped: it
 * is never decoded or drawn here. Returns a cancel.
 */
export function prefetchOtherBackdrop(theme: ResolvedTheme): () => void {
  asked.add(BACKDROP[theme]);
  const other = BACKDROP[theme === "light" ? "dark" : "light"];
  if (asked.has(other)) return () => undefined;
  return whenIdle(() => {
    asked.add(other);
    fetch(other, { priority: "low" })
      .then((response) => response.arrayBuffer())
      .catch(() => {
        asked.delete(other);
      });
  });
}

/**
 * Whether a picture is on screen: the start screen, as `backdrop.css`
 * selects it, and in the updated Instrument every page without a map
 * (`style-instrument-updated.css`).
 */
export function backdropShown(): boolean {
  if (document.querySelector('.layout-single > .panel[data-stage="choose-endpoint"]') !== null) {
    return true;
  }
  return (
    document.documentElement.dataset["variant"] === "updated" &&
    document.querySelector(".layout-single") !== null
  );
}

/** Load and decode a theme's picture: true once it can be drawn at once, false if it can't be had. */
export function backdropReady(theme: ResolvedTheme): Promise<boolean> {
  const image = new Image();
  image.src = BACKDROP[theme];
  return image.decode().then(
    () => true,
    () => false,
  );
}
