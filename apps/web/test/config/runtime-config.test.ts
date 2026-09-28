/**
 * `config.json`: checked whole, refused whole, and never the reason the page
 * fails to start. A refused or missing file means no relay and no presets,
 * and a warning that says which.
 */

import { describe, expect, it } from "vitest";
import {
  checkRuntimeConfig,
  loadRuntimeConfig,
  STATIC_ONLY,
  type ConfigFetch,
} from "../../src/config/runtime-config.js";

describe("checkRuntimeConfig — valid", () => {
  it.each([
    [{}, undefined],
    [{ relay: null }, undefined],
    [{ relay: null, presets: [] }, undefined],
    [{ relay: { url: "https://relay.example.org" } }, "https://relay.example.org"],
    [{ relay: { url: "https://relay.example.org/base/" } }, "https://relay.example.org/base"],
    [{ relay: { url: "/api" } }, "/api"],
    [{ relay: { url: "/api/" } }, "/api"],
    [{ relay: { url: "http://localhost:8787" } }, "http://localhost:8787"],
    [{ relay: { url: "http://127.0.0.1:8787" } }, "http://127.0.0.1:8787"],
    [{ relay: { url: "http://[::1]:8787" } }, "http://[::1]:8787"],
  ])("%j → relay %s", (input, relayUrl) => {
    expect(checkRuntimeConfig(input)).toEqual({ ok: true, config: { relayUrl, presets: [] } });
  });

  it("keeps https presets, trimmed, in order", () => {
    const result = checkRuntimeConfig({
      relay: null,
      presets: [
        { title: " Service A ", url: "https://a.example.org/ogc/" },
        { title: "Service B", url: "https://b.example.org" },
      ],
    });
    expect(result).toEqual({
      ok: true,
      config: {
        relayUrl: undefined,
        presets: [
          { title: "Service A", url: "https://a.example.org/ogc" },
          { title: "Service B", url: "https://b.example.org" },
        ],
      },
    });
  });
});

describe("checkRuntimeConfig — refused whole", () => {
  it.each([
    ["not an object", []],
    ["a string", "relay"],
    ["null", null],
    ["an unknown member (a typo)", { relayUrl: "https://relay.example.org" }],
    ["an unknown relay member", { relay: { url: "/api", token: "x" } }],
    ["relay as a string", { relay: "https://relay.example.org" }],
    ["a relay with no url", { relay: {} }],
    ["an empty relay url", { relay: { url: "" } }],
    ["a public http relay", { relay: { url: "http://relay.example.org" } }],
    ["a network-path relay", { relay: { url: "//relay.example.org" } }],
    ["a backslashed relay path", { relay: { url: "/\\relay.example.org" } }],
    ["a relay path with a query", { relay: { url: "/api?x=1" } }],
    ["a relative relay path without a slash", { relay: { url: "api" } }],
    ["a relay url with userinfo", { relay: { url: "https://u:p@relay.example.org" } }],
    ["a javascript: relay url", { relay: { url: "javascript:alert(1)" } }],
    ["presets as an object", { presets: {} }],
    ["an http preset", { presets: [{ title: "A", url: "http://a.example.org" }] }],
    ["a localhost http preset", { presets: [{ title: "A", url: "http://localhost:5080" }] }],
    ["a preset with an empty title", { presets: [{ title: " ", url: "https://a.example.org" }] }],
    ["a preset with no url", { presets: [{ title: "A" }] }],
    ["a preset with a query", { presets: [{ title: "A", url: "https://a.example.org/?k=1" }] }],
    [
      "a preset with an unknown member",
      { presets: [{ title: "A", url: "https://a.example.org", relay: true }] },
    ],
  ])("%s", (_label, input) => {
    const result = checkRuntimeConfig(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).not.toBe("");
  });
});

function serving(
  body: string,
  init: { status?: number; contentType?: string } = {},
): { fetch: ConfigFetch; asked: { input: string; init: RequestInit | undefined }[] } {
  const asked: { input: string; init: RequestInit | undefined }[] = [];
  return {
    asked,
    fetch: (input, requestInit) => {
      asked.push({ input, init: requestInit });
      return Promise.resolve(
        new Response(body, {
          status: init.status ?? 200,
          headers: { "Content-Type": init.contentType ?? "application/json" },
        }),
      );
    },
  };
}

describe("loadRuntimeConfig", () => {
  it("reads /config.json once, revalidated, without credentials", async () => {
    const served = serving('{"relay":{"url":"/api"}}');
    const loaded = await loadRuntimeConfig(served.fetch);
    expect(loaded).toEqual({ config: { relayUrl: "/api", presets: [] }, warning: undefined });
    expect(served.asked).toEqual([
      { input: "/config.json", init: { cache: "no-cache", credentials: "omit" } },
    ]);
  });

  it.each([
    ["missing (404)", serving("Not Found", { status: 404, contentType: "text/plain" }), /missing/],
    [
      "missing, answered with index.html by a development server",
      serving("<!doctype html>", { contentType: "text/html; charset=utf-8" }),
      /missing/,
    ],
    ["malformed", serving("{ relay: null"), /not valid JSON/],
    ["refused", serving('{"relay":{"url":"http://relay.example.org"}}'), /refused: relay\.url/],
    ["an extra member", serving('{"relay":null,"extra":1}'), /unknown member "extra"/],
  ])("%s: static-only, with a warning that says so", async (_label, served, why) => {
    const loaded = await loadRuntimeConfig(served.fetch);
    expect(loaded.config).toBe(STATIC_ONLY);
    expect(loaded.warning).toMatch(why);
    expect(loaded.warning).toMatch(/without the relay/);
  });

  it("a network failure: static-only, with a warning, never a rejection", async () => {
    const loaded = await loadRuntimeConfig(() => Promise.reject(new TypeError("offline")));
    expect(loaded.config).toBe(STATIC_ONLY);
    expect(loaded.warning).toMatch(/could not be loaded/);
  });
});

describe("the static site's config.json (deploy/static/)", () => {
  it("is valid, with no relay and no presets", () => {
    // Vite's glob import, as the form fixtures are read: the web project has
    // no Node types, and the file stays where the deploy expects it.
    const shipped = Object.values(
      import.meta.glob<unknown>("../../../../deploy/static/config.json", {
        eager: true,
        import: "default",
      }),
    );
    expect(shipped).toHaveLength(1);
    expect(checkRuntimeConfig(shipped[0])).toEqual({ ok: true, config: STATIC_ONLY });
  });
});
