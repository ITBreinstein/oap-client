/**
 * #27: a result that is one plain value is shown large in the updated
 * Instrument, its JSON folded beneath. Instrument as it is is unchanged.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ResultsView } from "../../src/app/ResultsView.js";
import { UpdatedContext } from "../../src/app/variant.js";
import { PLAIN_MAX_LENGTH, plainValue } from "../../src/results/plain-value.js";

describe("plainValue", () => {
  it("is a string, a number or a boolean as it is", () => {
    expect(plainValue("Hello World!")).toBe("Hello World!");
    expect(plainValue(42)).toBe(42);
    expect(plainValue(false)).toBe(false);
  });

  it("is the value of an { id, value } pair", () => {
    expect(plainValue({ id: "echo", value: "Hello Barcelona!" })).toBe("Hello Barcelona!");
    expect(plainValue({ value: 3.5 })).toBe(3.5);
  });

  it("is nothing for anything more", () => {
    expect(plainValue({ id: "echo", value: "hi", extra: 1 })).toBeUndefined();
    expect(plainValue({ id: "echo", value: { nested: true } })).toBeUndefined();
    expect(plainValue([1, 2])).toBeUndefined();
    expect(plainValue(null)).toBeUndefined();
    expect(plainValue({ type: "FeatureCollection", features: [] })).toBeUndefined();
  });

  it("is nothing for a long or multi-line string", () => {
    expect(plainValue("x".repeat(PLAIN_MAX_LENGTH + 1))).toBeUndefined();
    expect(plainValue("two\nlines")).toBeUndefined();
  });
});

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

function render(updated: boolean): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <UpdatedContext value={updated}>
        <ResultsView
          results={[{ kind: "json", outputId: "echo", value: { id: "echo", value: "Hello!" } }]}
          processId="hello-world"
          onLoad={() => Promise.resolve()}
        />
      </UpdatedContext>,
    );
  });
  return host;
}

describe("a plain result on screen", () => {
  it("is large in the updated Instrument, its JSON folded beneath", () => {
    const view = render(true);
    expect(view.querySelector("[data-plain-value]")?.textContent).toBe("Hello!");
    expect(view.querySelector("details")?.open).toBe(false);
  });

  it("stays JSON, open, in Instrument as it is", () => {
    const view = render(false);
    expect(view.querySelector("[data-plain-value]")).toBeNull();
    expect(view.querySelector("details")?.open).toBe(true);
  });
});
