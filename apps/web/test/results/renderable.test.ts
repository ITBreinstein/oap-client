/**
 * The result adapter (T10), fed real envelopes built by the core, with the
 * bodies the reference servers actually sent.
 */

import { createEnvelope, requireOk } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { runError } from "../../src/app/run.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { toRenderable } from "../../src/results/renderable.js";
import { fixtureProcess } from "../forms/helpers.js";

function envelope(body: BodyInit | null, headers: Record<string, string>, status = 200) {
  return createEnvelope(new Response(body, { status, headers }), {
    requestedUrl: "http://localhost:5080/processes/x/execution",
  });
}

describe("toRenderable", () => {
  it("splits pygeoapi's two-output results map into one result per output", async () => {
    const body = JSON.stringify({ echo: { label: "x" }, summary: 'label: "x"\n' });
    const results = await toRenderable(envelope(body, { "Content-Type": "application/json" }), {
      outputIds: ["echo", "summary"],
      processId: "breinstein-inputs",
    });
    // A bare string is text, as far as anything says otherwise.
    expect(results).toEqual([
      { kind: "json", outputId: "echo", value: { label: "x" } },
      { kind: "text", outputId: "summary", value: 'label: "x"\n', mediaType: "text/plain" },
    ]);
  });

  it("gives a bare string the media type its output declares", async () => {
    const body = JSON.stringify({ echo: { label: "x" }, summary: "a,b\n" });
    const results = await toRenderable(envelope(body, { "Content-Type": "application/json" }), {
      outputIds: ["echo", "summary"],
      processId: "p",
      declaredMediaTypes: { echo: "application/json", summary: "text/csv" },
    });
    expect(results[1]).toEqual({
      kind: "text",
      outputId: "summary",
      value: "a,b\n",
      mediaType: "text/csv",
    });
  });

  it("shows a single JSON output whole, even when it is an object", async () => {
    const feature = { type: "Feature", geometry: null, properties: {} };
    const results = await toRenderable(
      envelope(JSON.stringify(feature), { "Content-Type": "application/geo+json" }),
      { outputIds: ["feature"], processId: "breinstein-bbox" },
    );
    expect(results).toEqual([{ kind: "json", outputId: "feature", value: feature }]);
  });

  it("reads ZOO's qualified value, with its media type under format", async () => {
    const body = '{"b":{"value":"<a>x<\\/a>","format":{"mediaType":"text\\/xml"}}}';
    const results = await toRenderable(
      envelope(body, { "Content-Type": "application/json;charset=UTF-8" }),
      { outputIds: ["b"], processId: "echo" },
    );
    expect(results).toEqual([
      { kind: "text", outputId: "b", value: "<a>x</a>", mediaType: "text/xml" },
    ]);
  });

  it("shows text as text, HTML included, and never renders it", async () => {
    const results = await toRenderable(envelope("<b>bold</b>", { "Content-Type": "text/html" }), {
      outputIds: ["page"],
      processId: "p",
    });
    expect(results).toEqual([
      { kind: "text", outputId: "page", value: "<b>bold</b>", mediaType: "text/html" },
    ]);
  });

  it("offers anything else as a download, with a name and the media type", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const [result] = await toRenderable(envelope(png, { "Content-Type": "image/png" }), {
      outputIds: ["image"],
      processId: "breinstein-png",
    });
    expect(result).toMatchObject({
      kind: "download",
      outputId: "image",
      mediaType: "image/png",
      filename: "breinstein-png-image.png",
      reason: "not-text",
    });
    expect(result?.kind === "download" ? result.blob.size : 0).toBe(4);
  });

  it("uses the server's file name from Content-Disposition", async () => {
    const [result] = await toRenderable(
      envelope("x", {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="result.zip"',
      }),
      { outputIds: ["archive"], processId: "p" },
    );
    expect(result).toMatchObject({ kind: "download", filename: "result.zip" });
  });

  it("offers JSON larger than the display limit as a download", async () => {
    const [result] = await toRenderable(
      envelope(JSON.stringify({ big: "x".repeat(100) }), { "Content-Type": "application/json" }),
      { outputIds: ["o"], processId: "p", displayLimitBytes: 50 },
    );
    expect(result).toMatchObject({ kind: "download", reason: "too-large" });
  });

  it("shows a body labelled JSON that is not JSON as text (finding 0026)", async () => {
    const results = await toRenderable(
      envelope("<gml:Polygon/>", { "Content-Type": "application/json" }),
      { outputIds: ["Result"], processId: "Buffer" },
    );
    expect(results).toEqual([
      { kind: "text", outputId: "Result", value: "<gml:Polygon/>", mediaType: "application/json" },
    ]);
  });

  it("decodes a base64 qualified value into a download", async () => {
    const body = JSON.stringify({
      image: { value: "iVBORw==", mediaType: "image/png", encoding: "base64" },
    });
    const [result] = await toRenderable(envelope(body, { "Content-Type": "application/json" }), {
      outputIds: ["image"],
      processId: "p",
    });
    expect(result).toMatchObject({ kind: "download", mediaType: "image/png" });
    expect(result?.kind === "download" ? result.blob.size : 0).toBe(4);
  });
});

describe("runError on a real refusal", () => {
  it("shows pygeoapi's own words, and the input they name", async () => {
    const plan = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-bbox"));
    const refusal = envelope(
      JSON.stringify({
        type: "InvalidParameterValue",
        code: "InvalidParameterValue",
        description:
          'Error executing process: The "bbox" input must be in CRS84; received crs "http://www.opengis.net/def/crs/EPSG/0/4326"',
      }),
      { "Content-Type": "application/json" },
      400,
    );
    const cause: unknown = await requireOk(refusal).catch((error: unknown) => error);
    expect(runError(cause, plan)).toEqual({
      title: "The server refused the request (HTTP 400). Check the inputs and run again.",
      detail:
        'Error executing process: The "bbox" input must be in CRS84; received crs "http://www.opengis.net/def/crs/EPSG/0/4326"',
      inputId: "bbox",
    });
  });
});
