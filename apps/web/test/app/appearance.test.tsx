/**
 * The page's appearance: which style and theme it starts with, where each
 * comes from, what is saved, and the system's dark setting followed live.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  parseAppearance,
  readStoredAppearance,
  resolveTheme,
  saveAppearanceChoice,
  type AppearanceStorage,
} from "../../src/app/appearance.js";
import { AppearanceControl } from "../../src/app/AppearanceControl.js";
import { useAppearance, type AppearanceView } from "../../src/app/useAppearance.js";

/** A `Storage` stand-in over a plain map. */
function memoryStorage(initial: Record<string, string> = {}): AppearanceStorage & {
  readonly items: Map<string, string>;
} {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** Storage that refuses everything, as a private window or a blocked site can. */
const throwingStorage: AppearanceStorage = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
};

describe("parseAppearance", () => {
  it("starts from the defaults: the instrument style, following the system", () => {
    expect(parseAppearance("", undefined)).toEqual({ style: "instrument", theme: "system" });
    expect(DEFAULT_APPEARANCE).toEqual({ style: "instrument", theme: "system" });
  });

  it("takes the saved choice over the defaults", () => {
    expect(parseAppearance("", { style: "instrument-updated", theme: "dark" })).toEqual({
      style: "instrument-updated",
      theme: "dark",
    });
  });

  it("takes the address over the saved choice, member by member", () => {
    const saved = { style: "instrument-updated", theme: "dark" };
    expect(parseAppearance("?style=instrument", saved)).toEqual({
      style: "instrument",
      theme: "dark",
    });
    expect(parseAppearance("?theme=light", saved)).toEqual({
      style: "instrument-updated",
      theme: "light",
    });
    expect(parseAppearance("?style=instrument&theme=system", saved)).toEqual({
      style: "instrument",
      theme: "system",
    });
  });

  it("ignores values it does not know, from either source, without a word", () => {
    expect(parseAppearance("?style=brutalist&theme=sepia", undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("?style=INSTRUMENT", undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("?style=", { style: "instrument-updated" })).toEqual({
      style: "instrument-updated",
      theme: "system",
    });
    for (const stored of [
      null,
      42,
      "instrument",
      ["instrument", "dark"],
      { style: 1, theme: true },
      { style: "toString", theme: "__proto__" },
    ]) {
      expect(parseAppearance("", stored)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  it("keeps a good member of a saved value whose other member is bad", () => {
    expect(parseAppearance("", { style: "nope", theme: "dark" })).toEqual({
      style: "instrument",
      theme: "dark",
    });
  });
});

describe("resolveTheme", () => {
  it("follows the system only when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("saved choice", () => {
  it("reads what was saved, and nothing from text that is not JSON", () => {
    const storage = memoryStorage({ [APPEARANCE_STORAGE_KEY]: '{"style":"instrument-updated"}' });
    expect(readStoredAppearance(storage)).toEqual({ style: "instrument-updated" });
    expect(readStoredAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: "{not json" }))).toBe(
      undefined,
    );
    expect(readStoredAppearance(undefined)).toBeUndefined();
  });

  it("writes only the member the user changed, so a style from the address stays out", () => {
    const storage = memoryStorage({
      [APPEARANCE_STORAGE_KEY]: JSON.stringify({ style: "instrument", theme: "light" }),
    });
    // The page was opened with ?style=instrument-updated; the user then turned night mode on.
    saveAppearanceChoice(storage, { theme: "dark" });
    expect(JSON.parse(storage.items.get(APPEARANCE_STORAGE_KEY) ?? "")).toEqual({
      style: "instrument",
      theme: "dark",
    });
  });

  it("never throws when storage does", () => {
    expect(readStoredAppearance(throwingStorage)).toBeUndefined();
    expect(() => {
      saveAppearanceChoice(throwingStorage, { style: "instrument-updated" });
    }).not.toThrow();
    expect(parseAppearance("?theme=dark", readStoredAppearance(throwingStorage))).toEqual({
      style: "instrument",
      theme: "dark",
    });
  });
});

describe("useAppearance", () => {
  /** A `matchMedia` whose dark setting the test can change. */
  let dark = false;
  const listeners = new Set<() => void>();
  let root: Root | undefined;
  let view: AppearanceView | undefined;

  function Probe({ initial }: { readonly initial: Parameters<typeof useAppearance>[0] }) {
    view = useAppearance(initial);
    return null;
  }

  beforeEach(() => {
    dark = false;
    listeners.clear();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query === "(prefers-color-scheme: dark)" && dark;
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    }));
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    view = undefined;
    vi.unstubAllGlobals();
    delete document.documentElement.dataset["style"];
    delete document.documentElement.dataset["theme"];
    delete document.documentElement.dataset["variant"];
  });

  function mount(initial: Parameters<typeof useAppearance>[0]) {
    const host = document.createElement("div");
    const created = createRoot(host);
    root = created;
    act(() => {
      created.render(<Probe initial={initial} />);
    });
  }

  it("follows the system's setting live while the preference is system", () => {
    mount({ style: "instrument", theme: "system" });
    expect(view?.resolvedTheme).toBe("light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(document.documentElement.dataset["style"]).toBe("instrument");

    act(() => {
      dark = true;
      for (const listener of listeners) listener();
    });
    expect(view?.resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });

  it("stops following it once the user picks a theme, and saves the pick", () => {
    mount({ style: "instrument", theme: "system" });
    act(() => {
      view?.setTheme("light");
    });
    act(() => {
      dark = true;
      for (const listener of listeners) listener();
    });
    expect(view?.resolvedTheme).toBe("light");
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "")).toEqual({
      style: "instrument",
      theme: "light",
    });
  });

  it("changes the version at once, on <html> too: both are the instrument style", () => {
    mount({ style: "instrument", theme: "dark" });
    expect(document.documentElement.dataset["variant"]).toBe("current");
    act(() => {
      view?.setStyle("instrument-updated");
    });
    expect(view?.appearance).toEqual({ style: "instrument-updated", theme: "dark" });
    expect(document.documentElement.dataset["style"]).toBe("instrument");
    expect(document.documentElement.dataset["variant"]).toBe("updated");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});

describe("the Appearance control", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    document.body.replaceChildren();
  });

  it("applies a change at once, and Escape closes it with focus back on its button", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onStyle = vi.fn();
    const onTheme = vi.fn();
    const created = createRoot(host);
    root = created;
    act(() => {
      created.render(
        <AppearanceControl
          appearance={{ style: "instrument", theme: "system" }}
          onStyle={onStyle}
          onTheme={onTheme}
        />,
      );
    });
    const button = host.querySelector<HTMLButtonElement>("button.appearance-button");
    act(() => {
      button?.click();
    });
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    const legends = [...host.querySelectorAll("legend")].map((legend) => legend.textContent);
    expect(legends).toEqual(["Style", "Night mode"]);
    // Focus moved in, onto the choice already made.
    expect(document.activeElement).toBe(host.querySelector("input[value='instrument']"));

    act(() => {
      host.querySelector<HTMLInputElement>("input[value='instrument-updated']")?.click();
      host.querySelector<HTMLInputElement>("input[value='dark']")?.click();
    });
    expect(onStyle).toHaveBeenCalledWith("instrument-updated");
    expect(onTheme).toHaveBeenCalledWith("dark");

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector(".appearance-popover")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
