/**
 * #24: a foreground run says how long it has waited, offers a way out, and,
 * after ten seconds, that a long run can go in the background.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_HINT_SECONDS, WaitingForAnswer } from "../../src/app/ProcessScreen.js";

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.useRealTimers();
});

function render(canRunInBackground: boolean, onStop = vi.fn()): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(<WaitingForAnswer canRunInBackground={canRunInBackground} onStop={onStop} />);
  });
  return host;
}

const waited = (view: HTMLElement) => view.querySelector('[data-testid="waited"]')?.textContent;
const hint = (view: HTMLElement) => view.querySelector(".hint")?.textContent;

function wait(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

describe("waiting for a foreground run", () => {
  it("counts the seconds waited", () => {
    const view = render(true);
    expect(waited(view)).toBe("Waiting for the service: 0 s");
    wait(12);
    expect(waited(view)).toBe("Waiting for the service: 12 s");
  });

  it("keeps the count out of what a screen reader is read each second", () => {
    const view = render(true);
    expect(view.querySelector('[data-testid="waited"]')?.getAttribute("aria-live")).toBe("off");
  });

  it("suggests the background after ten seconds, when the process can run there", () => {
    const view = render(true);
    wait(BACKGROUND_HINT_SECONDS - 1);
    expect(hint(view)).toBeUndefined();
    wait(1);
    expect(hint(view)).toBe(
      "Long runs can go in the background: tick Run in the background next time.",
    );
  });

  it("never suggests the background to a process that can't run there", () => {
    const view = render(false);
    wait(60);
    expect(hint(view)).toBeUndefined();
  });

  it("stops waiting when asked", () => {
    const onStop = vi.fn();
    const view = render(true, onStop);
    const button = [...view.querySelectorAll("button")].find(
      (b) => b.textContent === "Stop waiting",
    );
    act(() => {
      button?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
