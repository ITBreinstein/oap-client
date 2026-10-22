/**
 * The relay's rate limit, as the page says it: driven through the whole App,
 * with the relay and a server that sends no CORS headers both answered by a
 * stubbed `fetch`. The user confirms the relay, and the relay refuses for its
 * rate — on the read route itself, or on the session the read route needs.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";

const RELAY = "http://relay.test";
const NOCORS = "http://nocors.test";

let root: Root | undefined;
let host: HTMLElement | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Relay": "1" },
  });
}

function tooMany(code: string, retryAfter: string): Response {
  return new Response(
    JSON.stringify({ type: "about:blank", title: "Too Many Requests", status: 429 }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/problem+json",
        "X-Relay": "1",
        "X-Relay-Error": code,
        "Retry-After": retryAfter,
      },
    },
  );
}

/** The relay and the server, with the relay's answer to a session and to a read given. */
function stubFetch(answers: { session: () => Response; read: () => Response }): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    // Against the page, as a browser's fetch takes a path: the page fetches its own
    // backdrop picture by one when it is idle, which a slow run reaches mid-test.
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin === NOCORS) return Promise.reject(new TypeError("Failed to fetch"));
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
    if (url.pathname === "/sessions") return Promise.resolve(answers.session());
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
    if (url.pathname.startsWith("/read/")) return Promise.resolve(answers.read());
    return Promise.resolve(json({ title: "not found" }, 404));
  });
}

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

/** Connect to `nocors`, and confirm the relay when it is offered. */
async function confirmRelay(): Promise<HTMLElement> {
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
  await act(async () => {
    button(view, "Use relay")?.click();
    await Promise.resolve();
  });
  await flush();
  return view;
}

describe("when the relay rate-limits", () => {
  it("says so, and for how long, when the read route is refused", async () => {
    stubFetch({
      session: () => json({ token: "session-1", expiresAt: Date.now() + 60_000 }, 201),
      read: () => tooMany("rate-limited", "6"),
    });
    const view = await confirmRelay();
    const alert = view.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toContain("Too many requests through the relay. Try again in 6 seconds.");
    expect(alert).toContain("(rate-limited)");
  });

  it("names the service's own ceiling apart from this page's", async () => {
    stubFetch({
      session: () => json({ token: "session-1", expiresAt: Date.now() + 60_000 }, 201),
      read: () => tooMany("rate-limited-endpoint", "1"),
    });
    const view = await confirmRelay();
    const alert = view.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toContain("Too many requests through the relay. Try again in 1 second.");
    expect(alert).toContain("(rate-limited-endpoint)");
  });

  it("says so too when the session the read route needs was refused, not that the relay is down", async () => {
    stubFetch({
      session: () => tooMany("rate-limited", "30"),
      read: () => json({ title: "unexpected" }, 500),
    });
    const view = await confirmRelay();
    const alert = view.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toContain("Too many requests through the relay. Try again in 30 seconds.");
    expect(alert).not.toContain("did not answer");
  });
});
