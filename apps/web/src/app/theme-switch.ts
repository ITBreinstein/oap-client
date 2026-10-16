/**
 * Switching between light and dark, in every style: a short crossfade from
 * the page as it was to the page as it is, where the browser can draw one
 * (the View Transitions API), and an instant switch everywhere else.
 *
 * The browser takes a picture of the page, lets the theme change, and fades
 * the old picture into the new page: colours and Instrument's backdrop
 * together, with no transition of our own on any colour. How long it takes is
 * in `styles.css` (`::view-transition-old(root)`).
 *
 * The switch is instant where the browser has no view transitions, where the
 * system asks for reduced motion, and where the new theme's picture isn't
 * ready within {@link READY_WAIT_MS}: a fade that ends on a half-drawn
 * backdrop is worse than none, and nobody should wait for a fade.
 */

export type SwitchMode = "fade" | "instant";

export interface SwitchConditions {
  /** The browser can draw a view transition. */
  readonly supported: boolean;
  /** The system asks for reduced motion. */
  readonly reducedMotion: boolean;
  /** The new theme's picture is decoded, or the page shows none. */
  readonly imageReady: boolean;
}

export function switchMode(conditions: SwitchConditions): SwitchMode {
  return conditions.supported && !conditions.reducedMotion && conditions.imageReady
    ? "fade"
    : "instant";
}

/** How long a switch waits for the new theme's picture before giving up the fade. */
export const READY_WAIT_MS = 500;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

function canTransition(): boolean {
  return "startViewTransition" in document;
}

/** The fade under way, so the next switch can cut it short. */
let running: ViewTransition | undefined;

/** End a fade under way at once, on the page it was fading to. */
export function skipThemeFade(): void {
  running?.skipTransition();
  running = undefined;
}

function fade(apply: () => void): void {
  const transition = document.startViewTransition(apply);
  running = transition;
  const done = () => {
    if (running === transition) running = undefined;
  };
  // A skipped transition rejects `ready`: expected, so not an error.
  transition.ready.catch(() => undefined);
  transition.finished.then(done, done);
}

/** True once `ready` says so, false if it fails or takes longer than `ms`. */
function within(ready: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, ms);
    ready.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/**
 * Change the theme on the page. `apply` writes it; `ready`, where the new
 * theme shows a picture, resolves true once that picture is decoded. A fade
 * already under way is cut short first, so quick toggling never sticks.
 * Returns a cancel for a switch still waiting for its picture: the next
 * switch makes it moot.
 */
export function switchTheme(apply: () => void, ready?: () => Promise<boolean>): () => void {
  skipThemeFade();
  const supported = canTransition();
  const reducedMotion = prefersReducedMotion();
  // No fade whatever the picture: switch now, without waiting for it.
  if (switchMode({ supported, reducedMotion, imageReady: true }) === "instant") {
    apply();
    return () => undefined;
  }
  // No picture to wait for (hybrid, precise, or not on the start screen).
  if (ready === undefined) {
    fade(apply);
    return () => undefined;
  }

  let cancelled = false;
  void within(ready(), READY_WAIT_MS).then((imageReady) => {
    if (cancelled) return;
    if (switchMode({ supported, reducedMotion, imageReady }) === "fade") fade(apply);
    else apply();
  });
  return () => {
    cancelled = true;
  };
}
