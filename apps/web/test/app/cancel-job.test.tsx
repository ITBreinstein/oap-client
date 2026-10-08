/**
 * "Cancel job" on a background run, through the whole App, for each answer a
 * server can give to `DELETE /jobs/{id}` (review T12). Each outcome is said on
 * the page and recorded as a `cancel-job` observation, which the matrix reads;
 * the browser lane only ever reaches "dismissed", on pygeoapi.
 *
 * The server is a fake `fetch` routed by path, as in `product-path.test.tsx`;
 * nothing touches the network.
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

let root: Root | undefined;
let host: HTMLElement | undefined;
/** Every run here starts a job the server names, the way pygeoapi does. */
const executeAnswer = (): Response =>
  json({ jobID: "j1", status: "accepted" }, 201, { Location: `${BASE}/jobs/j1` });
let dismissAnswer: () => Response | Promise<Response> = () => json({ title: "nope" }, 405);
const deletes: string[] = [];
const executes: { url: string; prefer: string | null }[] = [];

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  executes.length = 0;
  deletes.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.pathname.endsWith("/execution")) {
      executes.push({ url: url.toString(), prefer: new Headers(init?.headers).get("Prefer") });
      return executeAnswer();
    }
    if (method === "DELETE" && url.pathname === "/jobs/j1") {
      deletes.push(url.toString());
      return dismissAnswer();
    }
    if (url.pathname === "/jobs/j1") return json({ jobID: "j1", status: "running" });
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

function observations(view: HTMLElement): Record<string, unknown>[] {
  return [...view.querySelectorAll(".observation-list pre")].map(
    (pre) => JSON.parse(pre.textContent) as Record<string, unknown>,
  );
}

async function cancel(view: HTMLElement): Promise<void> {
  expect(view.querySelector("[data-job-ref]")).not.toBeNull();
  await act(async () => {
    button(view, "Cancel job")?.click();
    await Promise.resolve();
  });
  await flush();
}

function cancelRecord(view: HTMLElement): Record<string, unknown> | undefined {
  return observations(view).find((o) => o["kind"] === "cancel-job");
}

describe("Cancel job on a background run", () => {
  it("ends the run when the server dismisses the job, and records it", async () => {
    dismissAnswer = () => json({ jobID: "j1", status: "dismissed" });
    const view = await connectTyped(BASE);
    await runInBackground(view);
    await cancel(view);

    expect(deletes).toEqual([`${BASE}/jobs/j1`]);
    expect(view.textContent).toContain("Job cancelled. The server has dismissed it.");
    // pygeoapi's captured conformance declares no dismiss class, so the try
    // is recorded as advertised by nothing.
    expect(cancelRecord(view)).toMatchObject({
      outcome: "dismissed",
      processId: "breinstein-sync-only",
      advertisedBy: "nothing",
    });
  });

  it("says the server cannot cancel jobs on a 405, keeps the run, and records unsupported", async () => {
    dismissAnswer = () => json({ title: "Method Not Allowed" }, 405);
    const view = await connectTyped(BASE);
    await runInBackground(view);
    await cancel(view);

    expect(view.textContent).toContain(
      "The server says it cannot cancel jobs (HTTP 405). The job keeps running.",
    );
    expect(view.querySelector("[data-job-ref]")).not.toBeNull();
    expect(cancelRecord(view)).toMatchObject({ outcome: "unsupported", advertisedBy: "nothing" });
  });

  it("says the cancel failed when the server cannot be reached, and records failed", async () => {
    dismissAnswer = () => {
      throw new TypeError("Failed to fetch");
    };
    const view = await connectTyped(BASE);
    await runInBackground(view);
    await cancel(view);

    expect(view.textContent).toMatch(
      /The job could not be cancelled: .+\. It may still be running\./,
    );
    expect(view.querySelector("[data-job-ref]")).not.toBeNull();
    expect(cancelRecord(view)).toMatchObject({ outcome: "failed" });
  });
});
