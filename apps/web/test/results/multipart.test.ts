/**
 * Fix (b) of the response-document brief: a `multipart/related` raw answer
 * read by RFC 2046, tolerating exactly LF line endings and an unquoted
 * boundary, each recorded. From the captures of 2026-10-29 to 2026-11-01.
 */

import { createEnvelope } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { resultObservations } from "../../src/observations.js";
import {
  boundaryOf,
  mediaTypesNamed,
  readMultipart,
  type MultipartRead,
} from "../../src/results/multipart.js";
import { toRenderable, type RenderOptions } from "../../src/results/renderable.js";
import { envelopeOf, httpFixture } from "./http-fixtures.js";

const BELEIDSNORMEN = "beleidsnormen/execution/rustplekken-every-output-none.http";
const BELEIDSNORMEN_URL = "https://beleidsnormen.example/api/processes/rustplekken/execution";
const RUSTPLEKKEN: RenderOptions = {
  outputIds: ["percentage_voldoet", "legend_output", "geometry_output", "bankjes_output"],
  processId: "rustplekken",
};

const encode = (text: string) => new TextEncoder().encode(text);

/** The capture's Content-Type and body, as `readMultipart` takes them. */
function capture(key: string): { contentType: string; body: string } {
  const fixture = httpFixture(key);
  return { contentType: fixture.headers.get("content-type") ?? "", body: fixture.body };
}

function parts(read: MultipartRead) {
  if (!read.ok) throw new Error(`not read: ${read.reason}`);
  return read;
}

describe("the Beleidsnormen API's raw answer, the one clean case", () => {
  const { contentType, body } = capture(BELEIDSNORMEN);
  const quoted = contentType.replace(/boundary=([^;]+)/, 'boundary="$1"');

  it("is framed with LF alone and an unquoted boundary, as captured", () => {
    expect(body.includes("\r")).toBe(false);
    expect(boundaryOf(contentType)).toEqual({
      boundary: "===============0567850060356321290==",
      unquoted: true,
    });
  });

  it("is read with LF line endings tolerated, and says so (RFC 2046 §5.1.1)", () => {
    // The boundary quoted, as RFC 2045 wants it: only the line endings are off.
    const read = parts(readMultipart(quoted, encode(body)));
    expect(read.lenient).toEqual(["lf-line-endings"]);
    expect(read.parts.map((part) => part.headers["content-id"])).toEqual(RUSTPLEKKEN.outputIds);
  });

  it("is read with the unquoted boundary tolerated, and says so (RFC 2045 §5.1)", () => {
    // Every line ending made CRLF: only the boundary is off.
    const read = parts(readMultipart(contentType, encode(body.replace(/\n/g, "\r\n"))));
    expect(read.lenient).toEqual(["unquoted-boundary"]);
    expect(read.parts).toHaveLength(4);
  });

  it("needs no tolerance at all once both are put right", () => {
    const read = parts(readMultipart(quoted, encode(body.replace(/\n/g, "\r\n"))));
    expect(read.lenient).toEqual([]);
    expect(read.parts).toHaveLength(4);
  });

  it("ignores the header block it repeats before the first delimiter, as preamble", () => {
    const [first] = parts(readMultipart(contentType, encode(body))).parts;
    expect(first?.headers).toEqual({
      "content-type": "application/json",
      "content-id": "percentage_voldoet",
    });
    expect(new TextDecoder().decode(first?.body)).toBe("76.19249987042784");
  });

  it("shows each part as its output, and records both tolerances on each", async () => {
    const results = await toRenderable(envelopeOf(BELEIDSNORMEN, BELEIDSNORMEN_URL), RUSTPLEKKEN);
    expect(results.map((result) => `${result.kind}:${result.outputId}`)).toEqual([
      "json:percentage_voldoet",
      "json:legend_output",
      "json:geometry_output",
      "json:bankjes_output",
    ]);
    const geometry = results[2];
    expect(geometry?.kind === "json" && (geometry.value as { type?: unknown }).type).toBe(
      "FeatureCollection",
    );
    const observations = resultObservations(
      {
        runId: "run",
        endpoint: "https://beleidsnormen.example/api",
        processId: "rustplekken",
        declaredTransmission: ["value"],
        linkOutputs: [],
      },
      results,
    );
    expect(observations.map((observation) => observation.multipartLenient)).toEqual(
      Array.from({ length: 4 }, () => ["lf-line-endings", "unquoted-boundary"]),
    );
  });

  it("reads the 2026-10-29 answers, sent without outputs, the same way", async () => {
    const results = await toRenderable(
      envelopeOf("beleidsnormen/execution/rustplekken-no-response.http", BELEIDSNORMEN_URL),
      RUSTPLEKKEN,
    );
    expect(results.map((result) => result.kind)).toEqual(["json", "json", "json", "json"]);
  });

  it("says what each part was sent as, where a format was asked for", async () => {
    const results = await toRenderable(envelopeOf(BELEIDSNORMEN, BELEIDSNORMEN_URL), {
      ...RUSTPLEKKEN,
      askedFormats: { geometry_output: "application/geo+json" },
    });
    expect(results[2]).toMatchObject({
      asked: "application/geo+json",
      received: "application/json",
    });
  });
});

describe("what stays unread", () => {
  it("ZOO's by-value multipart: no line break before its delimiters (finding 0073)", async () => {
    const { contentType, body } = capture("zoo-project/execution/echo-two-outputs-raw.http");
    expect(readMultipart(contentType, encode(body))).toEqual({ ok: false, reason: "framing" });
    const results = await toRenderable(
      envelopeOf(
        "zoo-project/execution/echo-two-outputs-raw.http",
        "http://localhost:5090/ogc-api/processes/echo/execution",
      ),
      { outputIds: ["a", "b", "c", "pause"], processId: "echo" },
    );
    expect(results).toMatchObject([
      { kind: "download", reason: "multipart-unreadable", mediaType: "multipart/related" },
    ]);
    const [observation] = resultObservations(
      {
        runId: "run",
        endpoint: "http://localhost:5090/ogc-api",
        processId: "echo",
        declaredTransmission: ["value", "reference"],
        linkOutputs: [],
      },
      results,
    );
    expect(observation?.notReadBecause).toBe("multipart-unreadable");
    expect(observation?.multipartLenient).toBeUndefined();
  });

  it("Weaver's raw answer: two Content-Type headers, so neither is believed", async () => {
    const key = "weaver/execution/echo-two-outputs-raw.http";
    expect(mediaTypesNamed(capture(key).contentType)).toHaveLength(2);
    const results = await toRenderable(
      envelopeOf(key, "http://localhost:5100/processes/EchoProcess/execution"),
      { outputIds: ["stringOutput", "featureCollectionOutput"], processId: "EchoProcess" },
    );
    expect(results).toMatchObject([
      {
        kind: "download",
        outputId: "result",
        reason: "two-media-types",
        mediaType: expect.stringMatching(
          /^text\/html; charset=UTF-8, multipart\/mixed; /,
        ) as string,
      },
    ]);
  });

  it("a multipart with no close delimiter", () => {
    const read = readMultipart(
      'multipart/related; boundary="b"',
      encode("--b\r\nContent-ID: a\r\n\r\none\r\n--b\r\nContent-ID: c\r\n\r\ntwo"),
    );
    expect(read).toEqual({ ok: false, reason: "framing" });
  });

  it("a multipart with no boundary", () => {
    expect(readMultipart("multipart/related", encode("--b--"))).toEqual({
      ok: false,
      reason: "no-boundary",
    });
  });
});

describe("the RFC's own shapes", () => {
  const base = "https://ogc.example/processes/p/execution";
  const envelope = (body: string) =>
    createEnvelope(
      new Response(body, {
        headers: { "Content-Type": 'multipart/related; boundary="xyz"; type="text/plain"' },
      }),
      { requestedUrl: base },
    );

  it("reads a part with an empty body and a Content-Location as that output by reference", async () => {
    const body = [
      "--xyz",
      "Content-ID: <a>",
      "Content-Type: text/plain",
      "",
      "plugfest",
      "--xyz",
      "Content-ID: c",
      "Content-Type: application/geo+json",
      "Content-Location: ../results/c.geojson",
      "",
      "",
      "--xyz--",
      "",
    ].join("\r\n");
    const results = await toRenderable(envelope(body), {
      outputIds: ["a", "c"],
      processId: "p",
    });
    expect(results).toEqual([
      expect.objectContaining({
        kind: "text",
        outputId: "a",
        value: "plugfest",
        multipartLenient: [],
      }),
      {
        kind: "reference",
        outputId: "c",
        href: "https://ogc.example/processes/results/c.geojson",
        mediaType: "application/geo+json",
        multipartLenient: [],
      },
    ]);
  });

  it("reads ZOO's by-reference multipart by the RFC: its links are in the part bodies (finding 0060)", async () => {
    const results = await toRenderable(
      envelopeOf(
        "zoo-project/execution/echo-reference-raw-two.http",
        "http://localhost:5090/ogc-api/processes/echo/execution",
      ),
      { outputIds: ["a", "b", "c", "pause"], processId: "echo" },
    );
    expect(results.map((result) => result.kind)).toEqual(["text", "text"]);
    expect(results[0]?.kind === "text" && results[0].value).toMatch(/^Content-Location: /);
  });

  it("does not split on a comma inside a quoted parameter", () => {
    expect(mediaTypesNamed('multipart/related; boundary="a,b"')).toHaveLength(1);
  });
});
