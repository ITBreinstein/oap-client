/**
 * #16: "Find a place" asks after a pause in typing, lists what it found as
 * a combobox's options, and hands the chosen place on. Nothing is sent for
 * less than two letters, or for the name a choice put in the field.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceSearch, SUGGEST_AFTER_MS } from "../../src/app/PlaceSearch.js";
import type { Place, PlaceSearch as Search } from "../../src/places/locatieserver.js";

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

const AMERSFOORT: Place = {
  name: "Amersfoort, Amersfoort, Utrecht",
  extent: [5.3, 52.1, 5.5, 52.2],
};

function fakeSearch() {
  const asked: string[] = [];
  const search: Search = {
    suggest: (words) => {
      asked.push(`suggest ${words}`);
      return Promise.resolve([
        { id: "gem-1", name: "Gemeente Amersfoort", type: "gemeente" },
        { id: "wpl-1", name: "Amersfoort, Amersfoort, Utrecht", type: "woonplaats" },
      ]);
    },
    lookup: (id) => {
      asked.push(`lookup ${id}`);
      return Promise.resolve(AMERSFOORT);
    },
  };
  return { asked, search };
}

function render(search: Search, onPlace = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(<PlaceSearch search={search} onPlace={onPlace} />);
  });
  const view = host;
  const input = view.querySelector<HTMLInputElement>("input");
  if (input === null) throw new Error("no field");
  return { view, input, onPlace };
}

function type(input: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(SUGGEST_AFTER_MS);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function key(input: HTMLInputElement, name: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

describe("Find a place", () => {
  it("is a named combobox", () => {
    const { input, view } = render(fakeSearch().search);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(view.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Find a place");
  });

  it("asks once typing pauses, and not for one letter", async () => {
    const { asked, search } = fakeSearch();
    const { input } = render(search);
    type(input, "a");
    await settle();
    expect(asked).toEqual([]);
    type(input, "am");
    type(input, "amersfoort");
    await settle();
    expect(asked).toEqual(["suggest amersfoort"]);
  });

  it("lists what it found, and the keys choose", async () => {
    const { asked, search } = fakeSearch();
    const { input, view, onPlace } = render(search);
    type(input, "amersfoort");
    await settle();
    const options = [...view.querySelectorAll("[role='option']")];
    expect(options.map((option) => option.textContent)).toEqual([
      "Gemeente Amersfoort",
      "Amersfoort, Amersfoort, Utrecht",
    ]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    key(input, "Enter");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(asked.at(-1)).toBe("lookup wpl-1");
    expect(onPlace).toHaveBeenCalledWith(AMERSFOORT);
    expect(input.value).toBe("Amersfoort, Amersfoort, Utrecht");
    // The name a choice put there is not asked about again.
    await settle();
    expect(asked.filter((entry) => entry.startsWith("suggest"))).toHaveLength(1);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes its list on Escape", async () => {
    const { input } = render(fakeSearch().search);
    type(input, "amersfoort");
    await settle();
    key(input, "Escape");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("says when nothing was found, and when PDOK can't be asked", async () => {
    const empty: Search = {
      suggest: () => Promise.resolve([]),
      lookup: () => Promise.resolve(undefined),
    };
    const { input, view } = render(empty);
    type(input, "zzqq");
    await settle();
    expect(view.querySelector(".place-message")?.textContent).toBe("No place found for “zzqq”.");
    act(() => {
      root?.unmount();
    });
    host?.remove();
    const failing: Search = {
      suggest: () => Promise.reject(new Error("PDOK Locatieserver answered HTTP 503")),
      lookup: () => Promise.resolve(undefined),
    };
    const second = render(failing);
    type(second.input, "amersfoort");
    await settle();
    expect(second.view.querySelector(".place-message")?.textContent).toBe(
      "Places can't be searched now (PDOK Locatieserver answered HTTP 503).",
    );
  });
});
