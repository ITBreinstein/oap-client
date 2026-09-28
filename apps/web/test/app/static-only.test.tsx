/**
 * The static site: with no relay in `config.json`, no relay client is ever
 * made, nothing is fetched on start, and the page says what needs the relay.
 * The control — a relay configured — shows the same page does make one.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";
import { STATIC_ONLY, type RuntimeConfig } from "../../src/config/runtime-config.js";

const relayClients = vi.hoisted((): { made: string[] } => ({ made: [] }));

vi.mock("../../src/relay/relay-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/relay/relay-client.js")>();
  return {
    ...actual,
    createRelayClient: (...args: Parameters<typeof actual.createRelayClient>) => {
      relayClients.made.push(args[0]);
      return actual.createRelayClient(...args);
    },
  };
});

let root: Root | undefined;
let host: HTMLElement | undefined;
const fetched: string[] = [];

beforeEach(() => {
  relayClients.made.length = 0;
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

async function render(config: RuntimeConfig, configWarning?: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => {
    created.render(<App config={config} configWarning={configWarning} />);
    await Promise.resolve();
  });
  return host;
}

const RELAY_PATHS = /\/(endpoints|sessions|execute|read|callbacks)(\/|$)/;

describe("static-only", () => {
  it("makes no relay client, fetches nothing on start, and says what needs the relay", async () => {
    const view = await render(STATIC_ONLY);

    expect(relayClients.made).toEqual([]);
    expect(fetched).toEqual([]);
    expect(view.querySelector("[data-testid='static-only']")?.textContent).toMatch(
      /without the relay/,
    );
    expect(view.querySelector("[data-testid='relay-state']")?.textContent).toMatch(/off/);
    expect(view.querySelector("[data-testid='config-warning']")).toBeNull();
    // No offer to use the relay, and no banner saying it is in use.
    expect(view.textContent).not.toMatch(/Use relay/);
  });

  it("shows the fallback warning when the file could not be used", async () => {
    const view = await render(STATIC_ONLY, "This site's configuration (config.json) is missing.");
    expect(view.querySelector("[data-testid='config-warning']")?.textContent).toMatch(/missing/);
    expect(relayClients.made).toEqual([]);
  });

  it("offers config presets as choices, reached like a typed address", async () => {
    const view = await render({
      relayUrl: undefined,
      presets: [{ title: "Hosted service", url: "https://ogc.example.org/api" }],
    });
    expect(view.textContent).toContain("Hosted service");
    expect(view.textContent).toContain("https://ogc.example.org/api");
    expect(fetched).toEqual([]);
  });

  it("control: with a relay configured, the same page makes one and asks it for endpoints", async () => {
    await render({ relayUrl: "/api", presets: [] });
    expect(relayClients.made.length).toBeGreaterThan(0);
    expect(relayClients.made.every((baseUrl) => baseUrl === "/api")).toBe(true);
    expect(fetched.some((url) => RELAY_PATHS.test(url))).toBe(true);
  });
});
