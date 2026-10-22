/**
 * #3: the updated Instrument lists a service once, by a name a visitor can
 * read, and says "Always reached directly" of a typed address only.
 * Instrument as it is lists every entry by its key, as before.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EndpointScreen } from "../../src/app/EndpointScreen.js";
import { endpointName, humaniseKey, presetsMerged } from "../../src/app/service-list.js";
import { UpdatedContext } from "../../src/app/variant.js";
import type { RelayEndpoint } from "../../src/relay/contract.js";

const CORS: RelayEndpoint = {
  key: "pygeoapi-cors",
  baseUrl: "http://localhost:5080",
  executeRoute: "relay",
  readRoute: "direct",
  callbacks: true,
};
const NOCORS: RelayEndpoint = { ...CORS, key: "pygeoapi-nocors", baseUrl: "http://localhost:5081" };
const NOCORS_READ: RelayEndpoint = { ...NOCORS, key: "pygeoapi-nocors-relay", readRoute: "relay" };
const PRESETS = [
  { title: "pygeoapi, with CORS (local)", url: "http://localhost:5080/" },
  { title: "pygeoapi, without CORS (local)", url: "http://localhost:5081" },
  { title: "ZOO-Project (local)", url: "http://localhost:5090/ogc-api" },
];

describe("humaniseKey", () => {
  it("puts a key in words", () => {
    expect(humaniseKey("pygeoapi-cors")).toBe("Pygeoapi cors");
    expect(humaniseKey("pygeoapi-nocors-relay")).toBe("Pygeoapi nocors relay");
    expect(humaniseKey("zoo")).toBe("Zoo");
    expect(humaniseKey("my_service")).toBe("My service");
  });
});

describe("presetsMerged", () => {
  it("gives a preset to the relay endpoint of its address, the one the relay may read first", () => {
    const merged = presetsMerged(PRESETS, [CORS, NOCORS, NOCORS_READ]);
    expect([...merged]).toEqual([
      [0, "pygeoapi-cors"],
      [1, "pygeoapi-nocors-relay"],
    ]);
  });

  it("keeps a preset no endpoint shares an address with", () => {
    expect(presetsMerged(PRESETS, []).size).toBe(0);
  });
});

describe("endpointName", () => {
  it("is the title read this visit, else the preset's, else the key in words", () => {
    expect(endpointName(CORS, "pygeoapi (CORS enabled)", "local")).toBe("pygeoapi (CORS enabled)");
    expect(endpointName(CORS, undefined, "pygeoapi, with CORS (local)")).toBe(
      "pygeoapi, with CORS (local)",
    );
    expect(endpointName(CORS, undefined, undefined)).toBe("Pygeoapi cors");
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

function render(updated: boolean, titleOf?: (baseUrl: string) => string | undefined) {
  const onConnect = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <UpdatedContext value={updated}>
        <EndpointScreen
          configured={[CORS, NOCORS, NOCORS_READ]}
          configuredError={undefined}
          presets={PRESETS}
          connecting={undefined}
          error={undefined}
          staticOnly={false}
          onConnect={onConnect}
          titleOf={titleOf}
        />
      </UpdatedContext>,
    );
  });
  return { view: host, onConnect };
}

const rows = (view: HTMLElement) =>
  [...view.querySelectorAll(".choice-title")].map((title) => title.textContent);

const help = (view: HTMLElement) => view.querySelector(".address-field .help")?.textContent;

describe("the updated Instrument's list", () => {
  it("lists each service once, by name", () => {
    const { view } = render(true);
    expect(rows(view)).toEqual([
      "pygeoapi, with CORS (local)",
      "Pygeoapi nocors",
      "pygeoapi, without CORS (local)",
      "ZOO-Project (local)",
      "Another service",
    ]);
  });

  it("names a service by the title read this visit", () => {
    const { view } = render(true, (url) =>
      url === "http://localhost:5080" ? "pygeoapi (CORS enabled)" : undefined,
    );
    expect(rows(view)[0]).toBe("pygeoapi (CORS enabled)");
  });

  it("connects a merged row as its relay endpoint", () => {
    const { view, onConnect } = render(true);
    const radio = view.querySelector<HTMLInputElement>("input[value='pygeoapi-cors']");
    act(() => {
      radio?.click();
    });
    act(() => {
      [...view.querySelectorAll("button")].find((b) => b.textContent === "Connect")?.click();
    });
    expect(onConnect).toHaveBeenCalledWith({ source: "configured", ...CORS });
  });

  it("says “Always reached directly” of a typed address only", () => {
    const { view } = render(true);
    expect(help(view)).not.toContain("Always reached directly");
    act(() => {
      view.querySelector<HTMLInputElement>("input[value='pygeoapi-cors']")?.click();
    });
    expect(help(view)).not.toContain("Always reached directly");
    const input = view.querySelector<HTMLInputElement>("input[type='url']");
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "https://ogc.example.org",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(help(view)).toContain("Always reached directly");
  });
});

describe("Instrument as it is", () => {
  it("lists every entry, the relay's by their keys", () => {
    const { view } = render(false);
    expect(rows(view)).toEqual([
      "pygeoapi-cors",
      "pygeoapi-nocors",
      "pygeoapi-nocors-relay",
      "pygeoapi, with CORS (local)",
      "pygeoapi, without CORS (local)",
      "ZOO-Project (local)",
      "Another service",
    ]);
    expect(help(view)).toContain("Always reached directly");
  });
});
