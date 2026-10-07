/**
 * The product path through the whole App, for server quirks whose handling
 * lives in `useWorkflow` and had no test of its own there. Written for the
 * review of 2026-09-30, and kept with its known bugs until the last was fixed.
 *
 * - 0039: a background run whose 201 hides `Location` and has a `null` body.
 * - 0059: a background run the server answers synchronously.
 * - 0057: an execute a browser never sends (preflight refused).
 * - 0049/0050: a typed address that is simply down.
 * - W7: a result over the core's 8 MB that declares no length.
 *
 * The server is a fake `fetch` routed by path; nothing touches the network.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.js";
import { STATIC_ONLY } from "../../src/config/runtime-config.js";

const BASE = "http://localhost:5080";
const FIXTURES: Record<string, unknown> = import.meta.glob(
  "../../../../packages/core/test/fixtures/pygeoapi/{landing-page,conformance,processes/breinstein-sync-only}.json",
  { eager: true, import: "default" },
);
const fixture = (name: string): unknown => {
  const found = Object.entries(FIXTURES).find(([path]) => path.endsWith(`/pygeoapi/${name}`));
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return structuredClone(found[1]);
};

const description = fixture("processes/breinstein-sync-only.json") as Record<string, unknown>;
const summary = Object.fromEntries(
  Object.entries(description).filter(([key]) => key !== "inputs" && key !== "outputs"),
);

type ExecuteAnswer = () => Response | Promise<Response>;

let root: Root | undefined;
let host: HTMLElement | undefined;
let executeAnswer: ExecuteAnswer = () => new Response("null", { status: 201 });
let serverDown = false;
const executes: { url: string; prefer: string | null }[] = [];

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  executes.length = 0;
  serverDown = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    // What a browser shows script for a refused preflight, a CORS block or a
    // dead host alike: a TypeError and no response.
    if (serverDown) throw new TypeError("Failed to fetch");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.pathname.endsWith("/execution")) {
      executes.push({ url: url.toString(), prefer: new Headers(init?.headers).get("Prefer") });
      return executeAnswer();
    }
    switch (url.pathname) {
      case "/":
      case "":
        return json(fixture("landing-page.json"));
      case "/conformance":
        return json(fixture("conformance.json"));
      case "/processes":
        return json({ processes: [summary], links: [] });
      case "/processes/breinstein-sync-only":
        return json(description);
      default:
        return json({ title: "not found" }, 404);
    }
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

async function connectTyped(address: string): Promise<HTMLElement> {
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
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, address);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    button(view, "Connect")?.click();
    await Promise.resolve();
  });
  await flush();
  return view;
}

async function runInBackground(view: HTMLElement): Promise<void> {
  const open = button(view, "Slow process, foreground only");
  if (open === undefined) throw new Error(`process not listed: ${view.textContent}`);
  await act(async () => {
    open.click();
    await Promise.resolve();
  });
  await flush();
  const background = [...view.querySelectorAll<HTMLInputElement>("input[type='checkbox']")].find(
    (box) => box.parentElement?.textContent.includes("Run in the background") === true,
  );
  // pygeoapi describes this sync-only process with both modes (finding 0059),
  // so the page offers the choice.
  expect(background).toBeDefined();
  await act(async () => {
    background?.click();
    await Promise.resolve();
  });
  await act(async () => {
    button(view, "Run")?.click();
    await Promise.resolve();
  });
  await flush();
}

async function runInForeground(view: HTMLElement): Promise<void> {
  const open = button(view, "Slow process, foreground only");
  if (open === undefined) throw new Error(`process not listed: ${view.textContent}`);
  await act(async () => {
    open.click();
    await Promise.resolve();
  });
  await flush();
  await act(async () => {
    button(view, "Run")?.click();
    await Promise.resolve();
  });
  await flush(40);
}

function observations(view: HTMLElement): Record<string, unknown>[] {
  return [...view.querySelectorAll(".observation-list pre")].map(
    (pre) => JSON.parse(pre.textContent) as Record<string, unknown>,
  );
}

describe("finding 0039 on the product path: a background job the page cannot name", () => {
  it("says the server started a job it did not name, and records locationPresent: false", async () => {
    executeAnswer = () =>
      new Response("null", {
        status: 201,
        headers: { "Content-Type": "application/json", "Preference-Applied": "respond-async" },
      });
    const view = await connectTyped(BASE);
    await runInBackground(view);

    expect(executes).toHaveLength(1);
    expect(executes[0]?.prefer).toMatch(/respond-async/);
    expect(view.querySelector("[role='alert']")?.textContent).toContain(
      "The server started a job but did not tell this page where to find it.",
    );
    const execution = observations(view).find((o) => o["kind"] === "execution");
    expect(execution).toMatchObject({
      outcome: "error",
      status: 201,
      locationPresent: false,
      preferenceApplied: "ambiguous",
    });
    // No job was invented.
    expect(view.querySelector("[data-job-ref]")).toBeNull();
  });
});

describe("finding 0059 on the product path: asked for a job, answered with the result", () => {
  it("shows the synchronous answer as the result, and records the preference as ignored", async () => {
    executeAnswer = () =>
      json({ id: "slept", value: { seconds: 0, message: "" } }, 200, {
        "Preference-Applied": "wait",
        Location: `${BASE}/jobs/abc`,
      });
    const view = await connectTyped(BASE);
    await runInBackground(view);

    expect(executes[0]?.prefer).toMatch(/respond-async/);
    expect(view.querySelector('[data-output-id="slept"]')).not.toBeNull();
    const execution = observations(view).find((o) => o["kind"] === "execution");
    expect(execution).toMatchObject({
      outcome: "immediate",
      requestedMode: "async",
      disagreedWithRequestedMode: true,
      preferenceApplied: "ignored",
    });
  });
});

describe("W7 on the product path: a result over 8 MB that declares no length", () => {
  it("is offered as a download, not an error", async () => {
    // Chunked, as a streamed or compressed answer arrives: the core counts it
    // as it is read, and at its default 8 MB it was cut off.
    const body = new TextEncoder().encode(
      JSON.stringify({ id: "slept", value: { pad: "x".repeat(9 * 1024 * 1024) } }),
    );
    executeAnswer = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let at = 0; at < body.length; at += 1024 * 1024) {
              controller.enqueue(body.slice(at, at + 1024 * 1024));
            }
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const view = await connectTyped(BASE);
    await runInForeground(view);

    expect(view.querySelector("[role='alert']")?.textContent ?? "").toBe("");
    expect(view.querySelector('[data-output-id="slept"]')?.getAttribute("data-kind")).toBe(
      "download",
    );
  });
});

describe("finding 0057's other side: an execute the browser never sends", () => {
  it("W33: records whether the execute that never produced a response was cross-origin", async () => {
    const view = await connectTyped(BASE);
    executeAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
    await runInBackground(view);

    const alert = view.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toContain("The request did not complete.");
    expect(alert).not.toMatch(/CORS/);
    const execution = observations(view).find((o) => o["kind"] === "execution");
    // Cross-origin with no answer: a refused preflight is possible, so the
    // record says so rather than leaving it indistinguishable from same-origin.
    expect(execution).toMatchObject({ outcome: "transport-failure", crossOrigin: true });
  });
});

describe("findings 0049/0050: a typed address that is down, not CORS-less", () => {
  it("W34: is not reported to the user, as a certainty, as 'no CORS headers'", async () => {
    serverDown = true;
    const view = await connectTyped("http://localhost:5999");
    const alert = view.querySelector("[role='alert']")?.textContent ?? "";
    // Both, because a page cannot tell them apart; and what to check first.
    expect(alert).toContain("it sends no CORS headers, or it could not be reached");
    expect(alert).toContain("Check the address and that the server is running.");
    expect(alert).not.toContain("doesn't allow access from a web page");
    // The record stays cors-blocked, which the matrix reads as "CORS or down,
    // unconfirmed" until a relay attempt reaches the server.
    expect(observations(view).find((o) => o["kind"] === "endpoint-access")).toMatchObject({
      outcome: "cors-blocked",
    });
  });
});
