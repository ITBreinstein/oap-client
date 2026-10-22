/**
 * #6: the relay's services, while it does not answer, stay listed as they
 * were earlier this visit, but can't be chosen, and say why.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EndpointScreen } from "../../src/app/EndpointScreen.js";
import { UpdatedContext } from "../../src/app/variant.js";
import type { RelayEndpoint } from "../../src/relay/contract.js";

const CORS: RelayEndpoint = {
  key: "pygeoapi-cors",
  baseUrl: "http://localhost:5080",
  executeRoute: "relay",
  readRoute: "direct",
  callbacks: true,
};

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

function render(updated: boolean, presets: readonly { title: string; url: string }[] = []) {
  const onConnect = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <UpdatedContext value={updated}>
        <EndpointScreen
          configured={[]}
          unavailable={[CORS]}
          configuredError={undefined}
          presets={presets}
          connecting={undefined}
          error={undefined}
          staticOnly={false}
          onConnect={onConnect}
        />
      </UpdatedContext>,
    );
  });
  return { view: host, onConnect };
}

describe.each([false, true])("a relay service while the relay is down (updated: %s)", (updated) => {
  it("is listed, disabled, and says it is temporarily unavailable", () => {
    const { view } = render(updated);
    const radio = view.querySelector<HTMLInputElement>("input[value='pygeoapi-cors']");
    expect(radio?.disabled).toBe(true);
    expect(radio?.checked).toBe(false);
    const described = radio?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toBe("Temporarily unavailable");
  });

  it("is not what Connect opens", () => {
    const { view, onConnect } = render(updated);
    const connect = [...view.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    act(() => {
      connect?.click();
    });
    expect(onConnect).not.toHaveBeenCalled();
    expect(view.querySelector(".field-error")).not.toBeNull();
  });
});

describe("a relay service while the relay is down, with a preset of its address", () => {
  const PRESET = { title: "pygeoapi, with CORS (local)", url: "http://localhost:5080/" };

  it("is left to the preset in the updated Instrument: one row for one service", () => {
    const { view } = render(true, [PRESET]);
    expect(view.querySelector("input[value='pygeoapi-cors']")).toBeNull();
    expect(view.textContent).toContain("pygeoapi, with CORS (local)");
  });

  it("is listed beside it in Instrument as it is, which lists every entry", () => {
    const { view } = render(false, [PRESET]);
    expect(view.querySelector<HTMLInputElement>("input[value='pygeoapi-cors']")?.disabled).toBe(
      true,
    );
  });
});
