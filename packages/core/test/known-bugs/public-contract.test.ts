/**
 * Review: exported types and documented behaviour that the code does not keep.
 */

import { describe, expect, it } from "vitest";
import { getJob } from "../../src/index.js";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("JobStatus.exception", () => {
  it.fails(
    "C14: is populated when the job body itself is problem-shaped, as its doc comment says",
    async () => {
      // jobs/types.ts: "Populated when a server sends an `exception` member that
      // reads as a problem document, or when the job body itself is problem-shaped."
      const body = {
        jobID: "j1",
        status: "failed",
        type: "https://example.org/errors/boom",
        title: "Boom",
        detail: "it broke",
      };
      const status = await getJob("https://service.test/jobs/j1", {
        fetch: () => Promise.resolve(json(body)),
      });
      expect(status.exception?.detail).toBe("it broke");
    },
  );
});
