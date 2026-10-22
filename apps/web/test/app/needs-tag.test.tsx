/**
 * #8: in the updated Instrument a need is shown in a word beside its mark,
 * and an unknown one is an empty cell, never a dash. A screen reader hears
 * the same in both versions. Instrument as it is is unchanged.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { NeedsTag } from "../../src/app/NeedsTag.js";
import type { Needs } from "../../src/app/needs.js";
import { UpdatedContext } from "../../src/app/variant.js";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

function render(needs: Needs | undefined, updated: boolean): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <UpdatedContext value={updated}>
        <NeedsTag needs={needs} />
      </UpdatedContext>,
    );
  });
  return host;
}

/** What is on screen: everything but what is hidden from sight or from everyone. */
function seen(view: HTMLElement): string {
  const copy = view.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return "";
  copy.querySelectorAll(".visually-hidden, .needs-text").forEach((node) => {
    node.remove();
  });
  return copy.textContent;
}

/** What a screen reader hears: everything not aria-hidden. */
function heard(view: HTMLElement): string {
  const copy = view.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return "";
  copy.querySelectorAll("[aria-hidden='true']").forEach((node) => {
    node.remove();
  });
  return copy.textContent;
}

describe("the updated Instrument", () => {
  it.each([
    ["area", "Area", "Draw an area"],
    ["data", "Data", "Upload data"],
    ["values", "Values", "Just values"],
  ] as const)("shows %s as “%s”, and says “%s”", (needs, word, words) => {
    const view = render(needs, true);
    expect(seen(view)).toBe(word);
    expect(heard(view)).toBe(words);
  });

  it("shows nothing for a need not known yet, and says so", () => {
    const view = render(undefined, true);
    expect(seen(view)).toBe("");
    expect(view.textContent).not.toContain("—");
    expect(heard(view)).toBe("Not known yet");
  });
});

describe("Instrument as it is", () => {
  it("shows a mark only, and says the words", () => {
    const view = render("area", false);
    expect(seen(view)).toBe("");
    expect(view.querySelector(".needs-short")).toBeNull();
    expect(heard(view)).toBe("Draw an area");
  });

  it("keeps its dash for a need not known yet", () => {
    const view = render(undefined, false);
    expect(seen(view)).toBe("—");
    expect(heard(view)).toBe("Not known yet");
  });
});
