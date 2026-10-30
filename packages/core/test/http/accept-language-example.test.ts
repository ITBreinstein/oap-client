/**
 * The README's wrapped `fetch` for Weaver, which answers `Accept-Language: *`
 * (Node's default) with a 406: it sets the header and keeps every header the
 * core sends. The example is copied here verbatim, against a stubbed global
 * `fetch`, so the README cannot drift into code that drops the core's headers.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type FetchLike } from "../../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the README's Accept-Language example", () => {
  it("adds Accept-Language and keeps Content-Type, Accept and Prefer", async () => {
    const sent: { url: string; headers: Headers }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      sent.push({ url, headers: new Headers(init.headers) });
      return Promise.resolve(
        new Response(JSON.stringify({ jobID: "j", status: "accepted" }), {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            Location: "http://localhost:5100/jobs/j",
          },
        }),
      );
    });

    // --- the README's example, verbatim ---
    const withLanguage: FetchLike = (input, init) => {
      const headers = new Headers(init?.headers); // the core's headers, kept
      headers.set("Accept-Language", "en");
      return fetch(input, { ...init, headers });
    };

    const client = createClient({ baseUrl: "http://localhost:5100", fetch: withLanguage });
    // --- end of the example ---

    await client.execute("EchoProcess", { inputs: {}, outputs: {}, mode: "async" });
    const execute = sent.find((request) => request.url.endsWith("/execution"));
    expect(execute?.headers.get("accept-language")).toBe("en");
    expect(execute?.headers.get("content-type")).toBe("application/json");
    expect(execute?.headers.get("accept")).toBe("*/*");
    expect(execute?.headers.get("prefer")).toBe("respond-async");
  });
});
