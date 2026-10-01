/**
 * Review 2026-09-30 (read-only audit), finding 0026: ZOO labels raw results
 * `application/json` "whatever they actually are". The client's answer is to
 * try `JSON.parse` and fall back to text. That is right for GML and for a
 * bare literal, which is what ZOO was seen to send. What about bytes that are
 * not text at all, under the same label — inline and by reference?
 */

import { createEnvelope, type FetchLike } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { loadReference } from "../../src/results/reference.js";
import { toRenderable } from "../../src/results/renderable.js";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80,
]);

describe("a body labelled JSON that is not JSON (finding 0026)", () => {
  it("GML, as ZOO sends it, is shown as text — handled", async () => {
    const envelope = createEnvelope(
      new Response('<?xml version="1.0"?><ogr:FeatureCollection/>', {
        headers: { "Content-Type": "application/json;charset=UTF-8" },
      }),
      { requestedUrl: "http://localhost:5090/ogc-api/processes/Buffer/execution" },
    );
    const [result] = await toRenderable(envelope, { outputIds: ["Result"], processId: "Buffer" });
    expect(result).toMatchObject({ kind: "text", mediaType: "application/json" });
  });

  it.fails("W6: binary, inline: reaches the user as the bytes the server sent", async () => {
    const envelope = createEnvelope(
      new Response(PNG, { headers: { "Content-Type": "application/json" } }),
      { requestedUrl: "http://localhost:5090/ogc-api/processes/x/execution" },
    );
    const [result] = await toRenderable(envelope, { outputIds: ["r"], processId: "x" });
    // Today: a "text" result, and Download saves the UTF-8-decoded string.
    const saved = new Uint8Array(
      await (
        result?.kind === "download"
          ? result.blob
          : new Blob([result?.kind === "text" ? result.value : ""])
      ).arrayBuffer(),
    );
    expect(saved).toEqual(PNG);
  });

  it.fails("W6: binary, by reference: the loaded blob is the bytes the server sent", async () => {
    const href = "http://localhost:5090/temp/out.js";
    const fetch: FetchLike = () =>
      Promise.resolve(new Response(PNG, { headers: { "Content-Type": "application/json" } }));
    const loaded = await loadReference(
      { href },
      { endpoint: { baseUrl: "http://localhost:5090/ogc-api", reads: "direct" }, fetch },
    );
    expect(loaded).toMatchObject({ outcome: "ok", representation: "other" });
    // Today: the blob is rebuilt from decoded text.
    const saved = new Uint8Array((await loaded.blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(saved).toEqual(PNG);
  });
});
