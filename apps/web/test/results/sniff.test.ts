/**
 * Sniffing, within §11's limits: only a body labelled JSON that is not JSON;
 * the bytes first, from a closed list; after the size limits; never into HTML;
 * base64 tried only for an output declared so, and only after the bytes.
 */

import { createEnvelope } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { base64Bytes, magicOf } from "../../src/results/sniff.js";
import { plotStatus } from "../../src/results/plottable.js";
import { toRenderable, type RenderOptions } from "../../src/results/renderable.js";

const JSON_LABEL = "application/json;charset=UTF-8";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
const TIFF_LE = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0xff, 0xfe];
const TIFF_BE = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16];
const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Point><coordinates>5.12,52.09</coordinates></Point></Placemark></kml>`;

function envelope(body: BodyInit, contentType = JSON_LABEL) {
  return createEnvelope(
    new Response(body, { status: 200, headers: { "content-type": contentType } }),
    { requestedUrl: "http://localhost:5090/ogc-api/processes/p/execution" },
  );
}

async function only(body: BodyInit, options: Partial<RenderOptions> = {}, contentType?: string) {
  const [result] = await toRenderable(envelope(body, contentType), {
    outputIds: ["RESULT"],
    processId: "p",
    ...options,
  });
  if (result === undefined) throw new Error("no result");
  return result;
}

function base64(bytes: readonly number[] | string): string {
  const binary = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(binary);
}

describe("magic bytes", () => {
  it.each([
    ["TIFF, little-endian", TIFF_LE, "tiff"],
    ["TIFF, big-endian", TIFF_BE, "tiff"],
    ["PNG", PNG, "png"],
    ["JPEG", JPEG, "jpeg"],
    ["anything else", [0x50, 0x4b, 3, 4], undefined],
  ])("%s", (_, bytes, kind) => {
    expect(magicOf(Uint8Array.from(bytes))).toBe(kind);
  });
});

describe("a body labelled JSON that is not JSON", () => {
  it.each([
    ["a TIFF", TIFF_LE, "image/tiff", "tiff"],
    ["a PNG, then shown as one", PNG, "image/png", "png"],
    ["a JPEG", JPEG, "image/jpeg", "jpeg"],
  ])("%s is sniffed by its bytes and kept with its label", async (_, bytes, mediaType, kind) => {
    const result = await only(Uint8Array.from(bytes));
    expect(result).toMatchObject({
      kind: "download",
      mediaType,
      sniffed: { kind, declaredMediaType: JSON_LABEL },
      reason: "not-text",
    });
    if (result.kind !== "download") throw new Error("not a download");
    expect(result.blob.type).toBe(mediaType);
    expect(result.blob.size).toBe(bytes.length);
  });

  it("KML is sniffed by its root, read, and plotted", async () => {
    const result = await only(KML);
    expect(result).toMatchObject({ kind: "text", sniffed: { kind: "kml" }, geo: { ok: true } });
    expect(plotStatus(result).kind).toBe("plotted");
  });

  it.each([
    ["HTML", "<!DOCTYPE html><html><body><p>Error</p></body></html>"],
    ["XHTML", '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>'],
    ["XML of another kind", "<ows:ExceptionReport xmlns:ows='http://www.opengis.net/ows/1.1'/>"],
    ["XML with a DOCTYPE", `<!DOCTYPE kml>${KML}`],
    ["plain text", "Segmentation fault"],
  ])("%s is shown as text, as before, and nothing is claimed", async (_, body) => {
    const result = await only(body);
    expect(result).toMatchObject({ kind: "text", mediaType: "application/json" });
    expect(result).not.toHaveProperty("sniffed");
    expect(result).not.toHaveProperty("geo");
  });

  it("is not sniffed past the parse limit: the limits come first", async () => {
    const result = await only(KML, { parseLimitBytes: 16 });
    expect(result).toMatchObject({ kind: "download", reason: "too-large" });
    expect(result).not.toHaveProperty("sniffed");
  });

  it("past the display limit, is still read for the map and offered as a download", async () => {
    const result = await only(KML, { displayLimitBytes: 16 });
    expect(result).toMatchObject({
      kind: "download",
      reason: "too-large",
      mediaType: "application/vnd.google-earth.kml+xml",
      sniffed: { kind: "kml" },
    });
    expect(plotStatus(result).kind).toBe("plotted");
  });

  it("a body labelled anything else is never sniffed", async () => {
    const result = await only(Uint8Array.from(PNG), {}, "application/octet-stream");
    expect(result).toMatchObject({ kind: "download", mediaType: "application/octet-stream" });
    expect(result).not.toHaveProperty("sniffed");
  });
});

describe("declared base64, sent as it is (ZOO's KML and TIFF)", () => {
  it("looks at the bytes first: raw KML is read as it is, not decoded", async () => {
    const result = await only(KML, { base64Outputs: ["RESULT"] });
    expect(result).toMatchObject({ kind: "text", sniffed: { kind: "kml" } });
    expect(result).not.toHaveProperty("sniffed.base64");
  });

  it("then tries base64: a PNG sent as base64 is decoded and sniffed", async () => {
    const result = await only(base64(PNG), { base64Outputs: ["RESULT"] });
    expect(result).toMatchObject({
      kind: "download",
      mediaType: "image/png",
      sniffed: { kind: "png", base64: true },
    });
    if (result.kind !== "download") throw new Error("not a download");
    expect(result.blob.size).toBe(PNG.length);
  });

  it("and KML sent as base64 is decoded, read and plotted", async () => {
    const result = await only(base64(KML), { base64Outputs: ["RESULT"] });
    expect(result).toMatchObject({
      kind: "text",
      value: KML,
      sniffed: { kind: "kml", base64: true },
    });
    expect(plotStatus(result).kind).toBe("plotted");
  });

  it("does not try base64 for an output that does not declare it", async () => {
    const result = await only(base64(PNG));
    expect(result).toMatchObject({ kind: "text" });
    expect(result).not.toHaveProperty("sniffed");
  });

  it("decodes only text that is base64 throughout", () => {
    expect(base64Bytes("aGk=")).toEqual(Uint8Array.from([0x68, 0x69]));
    expect(base64Bytes("not base64!")).toBeUndefined();
    expect(base64Bytes("abc")).toBeUndefined();
  });
});
