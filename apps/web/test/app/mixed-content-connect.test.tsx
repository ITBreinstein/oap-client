// @vitest-environment-options { "url": "https://oap.example.nl/" }
/**
 * Connecting to a plain `http:` address from a page served over HTTPS. The
 * browser would block it, and cross-origin the failure looks exactly like a
 * missing CORS header — so the page refuses it before sending, says why, and
 * records `mixed-content`, never `cors-blocked`.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";
import { STATIC_ONLY } from "../../src/config/runtime-config.js";

let root: Root | undefined;
let host: HTMLElement | undefined;
const fetched: string[] = [];

beforeEach(() => {
  fetched.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    fetched.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

async function connectTo(address: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => {
    created.render(<App config={STATIC_ONLY} />);
    await Promise.resolve();
  });
  const view = host;
  const input = view.querySelector<HTMLInputElement>("input[type='url']");
  if (input === null) throw new Error("no address field");
  const [typed] = [...view.querySelectorAll<HTMLInputElement>("input[type='radio']")].filter(
    (radio) => radio.value === "typed",
  );
  await act(async () => {
    typed?.click();
    // React tracks the value through the native setter.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, address);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  const connect = [...view.querySelectorAll("button")].find((b) => b.textContent === "Connect");
  await act(async () => {
    connect?.click();
    await Promise.resolve();
  });
  return view;
}

function recordedOutcomes(view: HTMLElement): unknown[] {
  return [...view.querySelectorAll(".observation-list pre")]
    .map((pre): unknown => JSON.parse(pre.textContent))
    .filter(
      (entry): entry is { kind: string; outcome: unknown } =>
        typeof entry === "object" &&
        entry !== null &&
        "kind" in entry &&
        entry.kind === "endpoint-access",
    )
    .map((entry) => entry.outcome);
}

it("runs on an https: page", () => {
  expect(globalThis.location.protocol).toBe("https:");
});

it("refuses a public http: address before sending, and records mixed-content", async () => {
  const view = await connectTo("http://ogc.example.org/api");
  expect(fetched).toEqual([]);
  expect(view.textContent).toContain("blocks requests to a plain http:// address");
  expect(view.textContent).not.toMatch(/CORS headers\)/);
  expect(recordedOutcomes(view)).toEqual(["mixed-content"]);
});

it.each(["http://localhost:5080", "http://127.0.0.1:5080", "http://[::1]:5080"])(
  "sends to %s, which the browser exempts",
  async (address) => {
    const view = await connectTo(address);
    expect(fetched.some((url) => url.startsWith(address))).toBe(true);
    expect(recordedOutcomes(view)).not.toContain("mixed-content");
  },
);
