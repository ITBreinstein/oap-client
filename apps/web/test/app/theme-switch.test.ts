/**
 * Switching theme: when it fades and when it's instant, and how a switch
 * behaves around a fade under way and a picture that's slow to come.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  READY_WAIT_MS,
  skipThemeFade,
  switchMode,
  switchTheme,
  type SwitchConditions,
} from "../../src/app/theme-switch.js";

describe("switchMode", () => {
  const cases: [SwitchConditions, "fade" | "instant"][] = [
    [{ supported: true, reducedMotion: false, imageReady: true }, "fade"],
    [{ supported: false, reducedMotion: false, imageReady: true }, "instant"],
    [{ supported: true, reducedMotion: true, imageReady: true }, "instant"],
    [{ supported: true, reducedMotion: false, imageReady: false }, "instant"],
    [{ supported: false, reducedMotion: true, imageReady: false }, "instant"],
  ];

  it.each(cases)("%o: %s", (conditions, mode) => {
    expect(switchMode(conditions)).toBe(mode);
  });
});

describe("switchTheme", () => {
  /** A stand-in for the browser's view transitions: runs the update at once. */
  const transitions: { skipTransition: ReturnType<typeof vi.fn> }[] = [];
  let reducedMotion = false;

  function fakeTransition(update: () => void) {
    update();
    const transition = {
      ready: Promise.resolve(),
      finished: new Promise<void>(() => undefined),
      updateCallbackDone: Promise.resolve(),
      skipTransition: vi.fn(),
    };
    transitions.push(transition);
    return transition;
  }

  beforeEach(() => {
    transitions.length = 0;
    reducedMotion = false;
    Object.defineProperty(document, "startViewTransition", {
      value: fakeTransition,
      configurable: true,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
    }));
  });

  afterEach(() => {
    skipThemeFade();
    Reflect.deleteProperty(document, "startViewTransition");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fades where the browser can and there is no picture to wait for", () => {
    const apply = vi.fn();
    switchTheme(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(transitions).toHaveLength(1);
  });

  it("is instant without view transitions, and doesn't wait for the picture", () => {
    Reflect.deleteProperty(document, "startViewTransition");
    const apply = vi.fn();
    const ready = vi.fn(() => Promise.resolve(true));
    switchTheme(apply, ready);
    expect(apply).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
  });

  it("is instant where motion is reduced", () => {
    reducedMotion = true;
    const apply = vi.fn();
    switchTheme(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(transitions).toHaveLength(0);
  });

  it("cuts a fade under way short before the next switch", () => {
    switchTheme(vi.fn());
    switchTheme(vi.fn());
    expect(transitions).toHaveLength(2);
    expect(transitions[0]?.skipTransition).toHaveBeenCalledOnce();
    expect(transitions[1]?.skipTransition).not.toHaveBeenCalled();
  });

  it("fades once the picture is decoded", async () => {
    const apply = vi.fn();
    switchTheme(apply, () => Promise.resolve(true));
    expect(apply).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(apply).toHaveBeenCalledOnce();
    });
    expect(transitions).toHaveLength(1);
  });

  it(`switches without the fade when the picture takes longer than ${String(READY_WAIT_MS)} ms`, async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    switchTheme(apply, () => new Promise<boolean>(() => undefined));
    await vi.advanceTimersByTimeAsync(READY_WAIT_MS - 1);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).toHaveBeenCalledOnce();
    expect(transitions).toHaveLength(0);
  });

  it("switches without the fade when the picture can't be had", async () => {
    const apply = vi.fn();
    switchTheme(apply, () => Promise.resolve(false));
    await vi.waitFor(() => {
      expect(apply).toHaveBeenCalledOnce();
    });
    expect(transitions).toHaveLength(0);
  });

  it("drops a switch still waiting for its picture once cancelled", async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const cancel = switchTheme(apply, () => new Promise<boolean>(() => undefined));
    cancel();
    await vi.advanceTimersByTimeAsync(READY_WAIT_MS);
    expect(apply).not.toHaveBeenCalled();
  });
});
