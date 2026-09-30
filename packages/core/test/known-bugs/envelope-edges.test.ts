/**
 * Review: envelope parsing edges.
 */

import { describe, expect, it } from "vitest";
import { createEnvelope } from "../../src/http/envelope.js";
import { BodyTooLargeError } from "../../src/http/errors.js";
import { fetchJson } from "../../src/discovery/negotiate.js";

describe("Retry-After: prose is ignored outright (README, Polling section)", () => {
  // V8's Date.parse accepts a word followed by a number: "wait 10" is read as
  // a date in 2001, which is already elapsed and becomes 0 ms, the same failure
  // mode finding 0045 fixed for "-5".
  for (const value of ["wait 10", "later 2027", "A 1"]) {
    it.fails(`C9: "${value}" parses to undefined`, () => {
      const envelope = createEnvelope(
        new Response(null, { status: 200, headers: { "Retry-After": value } }),
        { requestedUrl: "https://service.test/jobs/j1" },
      );
      expect(envelope.retryAfterMs).toBeUndefined();
    });
  }
});

describe("fetchJson over the buffer limit", () => {
  it.fails("C2: reports BodyTooLargeError, not 'did not parse as JSON'", async () => {
    // Chunked body: no Content-Length, so the cap trips while counting.
    const big = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"conformsTo":["${"x".repeat(2048)}"]}`));
        controller.close();
      },
    });
    const fetch = (): Promise<Response> =>
      Promise.resolve(new Response(big, { headers: { "Content-Type": "application/json" } }));

    const error = await fetchJson("https://service.test/conformance", {
      fetch,
      maxBufferBytes: 1024,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BodyTooLargeError);
  });
});

describe("classify(): a declared problem document at 200", () => {
  it.fails(
    "C7: is an exception even when it carries only detail and status (type defaults to about:blank)",
    async () => {
      const { classify } = await import("../../src/http/classify.js");
      const envelope = createEnvelope(
        new Response(JSON.stringify({ detail: "backend unavailable", status: 503 }), {
          status: 200,
          headers: { "Content-Type": "application/problem+json" },
        }),
        { requestedUrl: "https://service.test/processes/p/execution" },
      );
      // README: "A body qualifies when the server declared application/problem+json";
      // "A 200 carrying a problem document is an exception, not ok".
      expect((await classify(envelope)).kind).toBe("exception");
    },
  );
});
