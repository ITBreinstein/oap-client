import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../msw.setup.js";
import { send } from "../../src/http/transport.js";
import { AbortError, TransportError } from "../../src/http/errors.js";

const BASE = "https://api.example.org";

describe("send", () => {
  it("returns an envelope for a 2xx", async () => {
    server.use(
      http.get(`${BASE}/processes`, () =>
        HttpResponse.json({ processes: [] }, { headers: { "content-type": "application/json" } }),
      ),
    );

    const env = await send(`${BASE}/processes`);
    expect(env.status).toBe(200);
    expect(env.requestedUrl).toBe(`${BASE}/processes`);
    expect(env.url).toBe(`${BASE}/processes`);
    expect(env.isJson).toBe(true);
    await expect(env.json()).resolves.toEqual({ processes: [] });
  });

  // A 404 is information. Deciding whether it is a failure needs the body, and
  // that is the classifier's call, not the transport's.
  it("does not throw on 4xx or 5xx", async () => {
    server.use(
      http.get(`${BASE}/missing`, () => new HttpResponse("gone", { status: 404 })),
      http.get(`${BASE}/broken`, () => new HttpResponse("boom", { status: 500 })),
    );

    await expect(send(`${BASE}/missing`)).resolves.toHaveProperty("status", 404);
    await expect(send(`${BASE}/broken`)).resolves.toHaveProperty("status", 500);
  });

  it("passes method, headers and body through, and uses the injected fetch", async () => {
    const seen: { url?: string; init?: RequestInit | undefined } = {};
    const fake = (url: string, init?: RequestInit): Promise<Response> => {
      seen.url = url;
      seen.init = init;
      return Promise.resolve(new Response("{}", { status: 201 }));
    };

    const env = await send(`${BASE}/processes/echo/execution`, {
      fetch: fake,
      method: "POST",
      headers: { prefer: "respond-async" },
      body: JSON.stringify({ inputs: {} }),
    });

    expect(env.status).toBe(201);
    expect(seen.url).toBe(`${BASE}/processes/echo/execution`);
    expect(seen.init?.method).toBe("POST");
    expect(seen.init).not.toHaveProperty("fetch");
    expect(seen.init).not.toHaveProperty("maxBufferBytes");
  });

  it("accepts a URL as well as a string", async () => {
    server.use(http.get(`${BASE}/ok`, () => new HttpResponse("", { status: 204 })));
    const env = await send(new URL(`${BASE}/ok`));
    expect(env.status).toBe(204);
  });

  it("resolves Location against the final URL after a redirect, not the requested one", async () => {
    server.use(
      http.post(`${BASE}/a/execution`, () =>
        HttpResponse.text("", { status: 308, headers: { location: `${BASE}/b/execution` } }),
      ),
      // http.all: which method survives a 308 is undici's business, not ours —
      // this test is about where a relative Location resolves.
      http.all(`${BASE}/b/execution`, () =>
        HttpResponse.text("", { status: 201, headers: { location: "../jobs/42" } }),
      ),
    );

    const env = await send(`${BASE}/a/execution`, { method: "POST" });

    expect(env.requestedUrl).toBe(`${BASE}/a/execution`);
    expect(env.url).toBe(`${BASE}/b/execution`);
    expect(env.locationRaw).toBe("../jobs/42");
    // Against the requested URL this would have been /a/jobs/42.
    expect(env.location).toBe(`${BASE}/jobs/42`);
  });

  it("wraps a fetch rejection as a TransportError, preserving the cause", async () => {
    const cause = new TypeError("Failed to fetch");
    const error = await send(`${BASE}/dead`, {
      fetch: () => Promise.reject(cause),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(TransportError);
    if (!(error instanceof TransportError)) return;
    expect(error.url).toBe(`${BASE}/dead`);
    expect(error.cause).toBe(cause);
    // No page origin in Node, so there is nothing to compare against.
    expect(error.crossOrigin).toBeUndefined();
  });

  it("records crossOrigin when there is a page origin to compare against", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.org" });
    try {
      const fail = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));

      const cross = await send(`${BASE}/processes`, { fetch: fail }).catch((err: unknown) => err);
      expect((cross as TransportError).crossOrigin).toBe(true);

      const same = await send("https://app.example.org/api", { fetch: fail }).catch(
        (err: unknown) => err,
      );
      // Same-origin cannot be CORS; that is the only inference we let the
      // observation layer make, and it needs this flag to make it.
      expect((same as TransportError).crossOrigin).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("raises AbortError, not TransportError, when the signal fires", async () => {
    const controller = new AbortController();
    const error = await send(`${BASE}/slow`, {
      signal: controller.signal,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
          controller.abort();
        }),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AbortError);
    expect(error).not.toBeInstanceOf(TransportError);
    expect((error as AbortError).name).toBe("AbortError");
  });

  it("treats a runtime that rejects an aborted request with a plain TypeError as an abort", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await send(`${BASE}/slow`, {
      signal: controller.signal,
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AbortError);
  });
});
