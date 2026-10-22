/**
 * #5: the updated Instrument asks the relay question in a visitor's words.
 * Instrument as it is keeps its own. Either way the answer is the user's.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RelayOffer } from "../../src/app/RelayRoute.js";
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

function render(updated: boolean, onConfirm = vi.fn(), onDecline = vi.fn()): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <UpdatedContext value={updated}>
        <RelayOffer onConfirm={onConfirm} onDecline={onDecline} />
      </UpdatedContext>,
    );
  });
  return host;
}

const buttons = (view: HTMLElement) =>
  [...view.querySelectorAll("button")].map((b) => b.textContent);

it("asks in a visitor's words in the updated Instrument, without the finding", () => {
  const view = render(true);
  expect(view.querySelector("h2")?.textContent).toBe("Open through Breinstein’s server?");
  expect(view.querySelector("[role='alertdialog'] p")?.textContent).toBe(
    "This service can’t be opened directly from a web page. Breinstein’s server can pass the requests on for you.",
  );
  expect(view.textContent).not.toContain("finding");
  expect(buttons(view)).toEqual(["Open", "Not now"]);
  // The safe answer still has the focus.
  expect(document.activeElement?.textContent).toBe("Not now");
});

it("keeps its own words in Instrument as it is", () => {
  const view = render(false);
  expect(view.querySelector("h2")?.textContent).toBe("Use the relay?");
  expect(view.textContent).toContain("This will be recorded as a finding.");
  expect(buttons(view)).toEqual(["Use relay", "Cancel"]);
});

it("goes through the relay only on Open", () => {
  const onConfirm = vi.fn();
  const onDecline = vi.fn();
  const view = render(true, onConfirm, onDecline);
  act(() => {
    [...view.querySelectorAll("button")].find((b) => b.textContent === "Not now")?.click();
  });
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onDecline).toHaveBeenCalledTimes(1);
  act(() => {
    [...view.querySelectorAll("button")].find((b) => b.textContent === "Open")?.click();
  });
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
