// @vitest-environment node
/**
 * Review 2026-09-30: a result over the envelope's buffer limit.
 *
 * With a declared Content-Length over the limit, `toRenderable` offers the
 * result as a download (`bodyTooLarge`). The same body without a declared
 * length — chunked, or gzip-compressed so the declared length is the smaller
 * compressed size — is caught only while it is read: `envelope.text()` rejects
 * with BodyTooLargeError, `toRenderable` rejects, and the user gets an error
 * instead of the download. The stream has been cancelled by then, so the
 * result of a synchronous run is gone.
 *
 * The limit is lowered to 1 kB here to stand in for the 8 MB default.
 */

import { createEnvelope } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { toRenderable } from "../../src/results/renderable.js";

const LIMIT = 1024;
const BODY = JSON.stringify({ type: "FeatureCollection", features: [], pad: "x".repeat(4096) });

function envelope(headers: Record<string, string>) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Two chunks, as a network body arrives.
      const bytes = new TextEncoder().encode(BODY);
      controller.enqueue(bytes.slice(0, 1000));
      controller.enqueue(bytes.slice(1000));
      controller.close();
    },
  });
  return createEnvelope(new Response(stream, { status: 200, headers }), {
    requestedUrl: "http://ogc.test/processes/p/execution",
    maxBufferBytes: LIMIT,
  });
}

describe("review: a result over the buffer limit", () => {
  it("is a download when its Content-Length says so (baseline, passes)", async () => {
    const results = await toRenderable(
      envelope({ "Content-Type": "application/json", "Content-Length": String(BODY.length) }),
      { outputIds: ["result"], processId: "p" },
    );
    expect(results.map((result) => result.kind)).toEqual(["download"]);
  });

  it.fails(
    "W7: is still a download when it declares no length (chunked or compressed)",
    async () => {
      const results = await toRenderable(envelope({ "Content-Type": "application/json" }), {
        outputIds: ["result"],
        processId: "p",
      });
      expect(results.map((result) => result.kind)).toEqual(["download"]);
    },
  );
});
