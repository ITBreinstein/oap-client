/**
 * One page, one relay session, one event stream (review W10, W11).
 *
 * Every visitor used to hold two streams open to the relay — the workflow's,
 * and the developer panel's, whose collapsed `<details>` still mounted it —
 * and in development StrictMode's mount, unmount, mount leaked two more.
 * Browsers allow six HTTP/1.1 connections per host, so three tabs could stall
 * every further request to the relay.
 */

import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";

const RELAY = "http://relay.test";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

/** A relay that hands out sessions and holds each stream open, and counts both. */
function countingRelay() {
  const calls: string[] = [];
  let issued = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url}`);
    if (url === `${RELAY}/endpoints`) return Promise.resolve(Response.json({ endpoints: [] }));
    if (url === `${RELAY}/sessions` && method === "POST") {
      issued += 1;
      return Promise.resolve(
        Response.json({ token: `s${String(issued)}`, expiresAt: 0 }, { status: 201 }),
      );
    }
    if (url === `${RELAY}/sessions/events`) {
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>(), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  return {
    sessions: () => calls.filter((call) => call === `POST ${RELAY}/sessions`).length,
    streams: () => calls.filter((call) => call === `GET ${RELAY}/sessions/events`).length,
  };
}

async function render(page: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => {
    created.render(page);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const app = <App config={{ relayUrl: RELAY, presets: [] }} />;

describe("relay sessions per page", () => {
  it("opens one session and one stream", async () => {
    const relay = countingRelay();
    await render(app);
    expect({ sessions: relay.sessions(), streams: relay.streams() }).toEqual({
      sessions: 1,
      streams: 1,
    });
  });

  it("opens one session and one stream under StrictMode's mount, unmount, mount", async () => {
    const relay = countingRelay();
    await render(<StrictMode>{app}</StrictMode>);
    expect({ sessions: relay.sessions(), streams: relay.streams() }).toEqual({
      sessions: 1,
      streams: 1,
    });
  });

  it("gives the developer panel's own session only while that panel is open", async () => {
    const relay = countingRelay();
    await render(app);
    const panel = host?.querySelector<HTMLDetailsElement>("details.developer");
    if (panel === undefined || panel === null) throw new Error("no developer panel");
    await act(async () => {
      panel.open = true;
      panel.dispatchEvent(new Event("toggle"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(relay.sessions()).toBe(2);
    expect(host?.querySelector("[data-testid='relay-state']")).not.toBeNull();
  });
});
