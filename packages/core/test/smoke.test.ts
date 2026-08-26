import { describe, expect, it } from "vitest";
import { createClient, ProcessesError, VERSION } from "../src/index.js";

describe("core", () => {
  it("exposes a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("keeps the last path segment of the base URL", () => {
    const client = createClient({
      baseUrl: "https://example.org/ogc",
      fetch: () => Promise.resolve(new Response("{}")),
    });
    expect(client.baseUrl.href).toBe("https://example.org/ogc/");
  });

  it("resolves a path against the base and returns an envelope", async () => {
    let seen: string | undefined;
    const client = createClient({
      baseUrl: "https://example.org/ogc",
      fetch: (url) => {
        seen = url;
        return Promise.resolve(
          new Response('{"processes":[]}', { headers: { "content-type": "application/json" } }),
        );
      },
    });

    const env = await client.send("processes");
    expect(seen).toBe("https://example.org/ogc/processes");
    expect(env.status).toBe(200);
    await expect(env.json()).resolves.toEqual({ processes: [] });
  });

  it("fails at construction, not on first request, when there is no fetch", () => {
    const original = globalThis.fetch;
    // @ts-expect-error deleting a required global for the duration of the test
    delete globalThis.fetch;
    try {
      expect(() => createClient({ baseUrl: "https://example.org" })).toThrow(TypeError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("carries the server's problem document on the error", async () => {
    const client = createClient({
      baseUrl: "https://example.org/ogc",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ type: "urn:x:nope", title: "Nope" }), {
            status: 400,
            headers: { "content-type": "application/problem+json" },
          }),
        ),
    });

    const { requireOk } = await import("../src/index.js");
    const error = await requireOk(await client.send("processes")).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProcessesError);
    expect((error as ProcessesError).problem?.title).toBe("Nope");
  });
});
