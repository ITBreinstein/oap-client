/**
 * #2: in the updated Instrument the featured examples come right under the
 * address row, before the known services. Instrument as it is keeps them
 * after the card.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { EndpointScreen } from "../../src/app/EndpointScreen.js";
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

function render(updated: boolean): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <UpdatedContext value={updated}>
        <EndpointScreen
          configured={[]}
          configuredError={undefined}
          presets={[{ title: "A service", url: "https://ogc.example.org" }]}
          connecting={undefined}
          error={undefined}
          staticOnly={false}
          onConnect={() => undefined}
          examples={<section className="featured-examples">Examples</section>}
        />
      </UpdatedContext>,
    );
  });
  return host;
}

const follows = (a: Element | null, b: Element | null) =>
  a !== null &&
  b !== null &&
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

it("puts the examples between the address and the services in the updated Instrument", () => {
  const view = render(true);
  const address = view.querySelector(".address-field");
  const examples = view.querySelector(".featured-examples");
  const services = view.querySelector(".service-choices");
  expect(follows(address, examples)).toBe(true);
  expect(follows(examples, services)).toBe(true);
  expect(view.querySelectorAll(".featured-examples")).toHaveLength(1);
});

it("keeps the examples after the card in Instrument as it is", () => {
  const view = render(false);
  const examples = view.querySelector(".featured-examples");
  expect(examples?.parentElement?.classList.contains("start")).toBe(true);
  expect(follows(view.querySelector(".start-card"), examples)).toBe(true);
  expect(view.querySelectorAll(".featured-examples")).toHaveLength(1);
});
