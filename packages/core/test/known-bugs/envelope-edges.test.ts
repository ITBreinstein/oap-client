/**
 * Review: envelope parsing edges.
 */

import { describe, expect, it } from "vitest";
import { createEnvelope } from "../../src/http/envelope.js";

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
