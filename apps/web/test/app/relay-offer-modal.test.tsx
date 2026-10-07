/**
 * The relay offer as a modal (review W22): while it is open the page behind
 * it is inert, Connect does nothing, and Escape declines from anywhere on the
 * page. Driven through the whole App, with the relay and a server that sends
 * no CORS headers both answered by a stubbed `fetch`.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";

const RELAY = "http://relay.test";
const NOCORS = "http://nocors.test";

let root: Root | undefined;
let host: HTMLElement | undefined;
const direct: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Relay": "1" },
  });
}

beforeEach(() => {
  direct.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === NOCORS) {
      direct.push(url.pathname);
      // What a page sees of a server that sends no CORS headers.
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (url.pathname === "/endpoints") {
      return Promise.resolve(
        json({
          endpoints: [
            {
              key: "nocors",
              baseUrl: NOCORS,
              executeRoute: "relay",
              readRoute: "relay",
              callbacks: false,
            },
          ],
        }),
      );
    }
    if (url.pathname === "/sessions") {
      return Promise.resolve(json({ token: "session-1", expiresAt: Date.now() + 60_000 }, 201));
    }
    if (url.pathname === "/sessions/events") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: ready\ndata: {}\n\n"));
        },
      });
      return Promise.resolve(
        new Response(body, { headers: { "Content-Type": "text/event-stream", "X-Relay": "1" } }),
      );
    }
    return Promise.resolve(json({ title: "not found" }, 404));
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

async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function button(view: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...view.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
}

/** The App with the relay configured, connected to `nocors`: the offer is open. */
async function offered(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => {
    created.render(<App config={{ relayUrl: RELAY, presets: [] }} />);
    await Promise.resolve();
  });
  await flush();
  const view = host;
  const radio = view.querySelector<HTMLInputElement>("input[type='radio'][value='nocors']");
  if (radio === null) throw new Error(`no configured endpoint: ${view.textContent}`);
  await act(async () => {
    radio.click();
    await Promise.resolve();
  });
  await act(async () => {
    button(view, "Connect")?.click();
    await Promise.resolve();
  });
  await flush();
  expect(view.querySelector("[data-testid='relay-offer']")).not.toBeNull();
  return view;
}

describe("the relay offer while it is open (review W22)", () => {
  it("makes the page behind it inert, and not the question itself", async () => {
    const view = await offered();
    const connect = button(view, "Connect");
    expect(connect?.closest("[inert]")).not.toBeNull();
    expect(view.querySelector("[data-testid='my-jobs']")?.closest("[inert]")).not.toBeNull();
    expect(view.querySelector("[data-testid='relay-offer']")?.closest("[inert]")).toBeNull();
    expect(button(view, "Use relay")?.closest("[inert]")).toBeNull();
  });

  it("does nothing on Connect: the open attempt keeps its question", async () => {
    const view = await offered();
    const attempts = direct.length;
    // Inert stops a user; a script's click still lands, and must change nothing.
    await act(async () => {
      button(view, "Connect")?.click();
      await Promise.resolve();
    });
    await flush();
    expect(direct).toHaveLength(attempts);
    expect(view.querySelector("[data-testid='relay-offer']")).not.toBeNull();
  });

  it("declines on Escape pressed anywhere, before focus has moved into it", async () => {
    const view = await offered();
    document.body.focus();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(view.querySelector("[data-testid='relay-offer']")).toBeNull();
    expect(view.querySelector("[role='alert']")?.textContent).toContain(
      "it sends no CORS headers, or it could not be reached",
    );
    expect(button(view, "Connect")?.closest("[inert]")).toBeNull();
  });
});
