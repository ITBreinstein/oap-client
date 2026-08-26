import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, DEFAULT_MAX_BUFFER_BYTES } from "../../src/http/envelope.js";
import { BodyTooLargeError } from "../../src/http/errors.js";

const BASE = "https://example.org/ogc/jobs/abc";

function envelope(body: BodyInit | null, init: ResponseInit = {}, requestedUrl = BASE) {
  return createEnvelope(new Response(body, init), { requestedUrl });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("media type", () => {
  it("parses type and parameters, and lowercases the essence", () => {
    const env = envelope("{}", {
      headers: { "content-type": 'Application/GeoJSON; charset=UTF-8; profile="urn:x:p"' },
    });
    expect(env.mediaType).toBe("application/geojson");
    expect(env.mediaTypeParams).toEqual({ charset: "UTF-8", profile: "urn:x:p" });
  });

  it("reads the +json structured suffix as JSON", () => {
    for (const type of ["application/json", "application/geo+json", "application/problem+json"]) {
      expect(envelope("{}", { headers: { "content-type": type } }).isJson).toBe(true);
    }
    expect(envelope("", { headers: { "content-type": "application/xml" } }).isJson).toBe(false);
    // Not a structured suffix — a subtype that merely ends in the letters.
    expect(envelope("", { headers: { "content-type": "application/notjson" } }).isJson).toBe(false);
  });

  it("leaves mediaType undefined for a malformed header but keeps the raw one", () => {
    const env = envelope("body", { headers: { "content-type": "not-a-media-type" } });
    expect(env.mediaType).toBeUndefined();
    expect(env.headers.get("content-type")).toBe("not-a-media-type");
  });

  it("leaves mediaType undefined when the header is absent", () => {
    const env = createEnvelope(new Response(null, { status: 204 }), { requestedUrl: BASE });
    expect(env.mediaType).toBeUndefined();
    expect(env.mediaTypeParams).toEqual({});
  });

  it("never rejects a body it cannot name", async () => {
    const env = envelope("plain bytes", { headers: { "content-type": ";;;" } });
    expect(env.mediaType).toBeUndefined();
    await expect(env.text()).resolves.toBe("plain bytes");
  });
});

describe("headers", () => {
  it("carries Content-Crs verbatim", () => {
    const crs = "<http://www.opengis.net/def/crs/OGC/1.3/CRS84>";
    expect(envelope("{}", { headers: { "content-crs": crs } }).contentCrs).toBe(crs);
  });

  it("reads a filename from Content-Disposition", () => {
    expect(
      envelope("x", { headers: { "content-disposition": 'attachment; filename="result.tif"' } })
        .filename,
    ).toBe("result.tif");
  });

  it("prefers the RFC 5987 filename* form and strips any path", () => {
    const env = envelope("x", {
      headers: {
        "content-disposition":
          "attachment; filename=\"fallback.txt\"; filename*=UTF-8''%2Fetc%2Fr%C3%A9sultat.tif",
      },
    });
    expect(env.filename).toBe("résultat.tif");
  });

  it("has no filename when the header is absent", () => {
    expect(envelope("x").filename).toBeUndefined();
  });

  it("reads Retry-After as delta-seconds", () => {
    expect(envelope(null, { status: 202, headers: { "retry-after": "12" } }).retryAfterMs).toBe(
      12_000,
    );
  });

  it("reads Retry-After as an HTTP-date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const env = envelope(null, {
      status: 503,
      headers: { "retry-after": "Mon, 24 Aug 2026 12:00:30 GMT" },
    });
    expect(env.retryAfterMs).toBe(30_000);
  });

  it("clamps an already-elapsed Retry-After date to zero", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const env = envelope(null, {
      status: 503,
      headers: { "retry-after": "Mon, 24 Aug 2026 11:59:00 GMT" },
    });
    expect(env.retryAfterMs).toBe(0);
  });

  it("ignores an unparseable Retry-After", () => {
    expect(envelope(null, { headers: { "retry-after": "soon" } }).retryAfterMs).toBeUndefined();
  });
});

describe("location", () => {
  it("resolves a relative Location against the response URL and keeps the raw value", () => {
    const env = envelope(null, { status: 201, headers: { location: "../jobs/xyz" } });
    expect(env.location).toBe("https://example.org/ogc/jobs/xyz");
    expect(env.locationRaw).toBe("../jobs/xyz");
  });

  it("leaves an absolute Location alone", () => {
    const env = envelope(null, {
      status: 201,
      headers: { location: "https://other.example/jobs/1" },
    });
    expect(env.location).toBe("https://other.example/jobs/1");
  });

  it("has no location when the header is absent", () => {
    expect(envelope("{}").location).toBeUndefined();
    expect(envelope("{}").locationRaw).toBeUndefined();
  });
});

describe("links", () => {
  it("parses the Link header, resolving relative hrefs", () => {
    const env = envelope("{}", {
      headers: {
        link: '</ogc/jobs/abc/results>; rel="results"; type="application/json", <https://example.org/ogc/jobs>; rel="up"; title="Jobs, all of them"',
      },
    });

    expect(env.links).toHaveLength(2);
    expect(env.links[0]).toMatchObject({
      href: "https://example.org/ogc/jobs/abc/results",
      hrefRaw: "/ogc/jobs/abc/results",
      rel: "results",
      type: "application/json",
    });
    // The comma inside the quoted title must not split the entry.
    expect(env.links[1]?.title).toBe("Jobs, all of them");
  });

  it("is empty when there is no Link header", () => {
    expect(envelope("{}").links).toEqual([]);
  });
});

describe("readers", () => {
  it("lets json() and text() both run, in that order", async () => {
    const env = envelope('{"status":"successful"}', {
      headers: { "content-type": "application/json" },
    });

    await expect(env.json()).resolves.toEqual({ status: "successful" });
    // The body streamed once; this comes from the buffer.
    await expect(env.text()).resolves.toBe('{"status":"successful"}');
    await expect(env.json()).resolves.toEqual({ status: "successful" });
  });

  it("lets text() run before json()", async () => {
    const env = envelope('{"a":1}', { headers: { "content-type": "application/json" } });
    await expect(env.text()).resolves.toBe('{"a":1}');
    await expect(env.json()).resolves.toEqual({ a: 1 });
  });

  it("serves blob() and arrayBuffer() from the same buffer", async () => {
    const env = envelope("GEOTIFF", { headers: { "content-type": "image/tiff" } });
    const blob = await env.blob();
    expect(blob.type).toBe("image/tiff");
    expect(blob.size).toBe(7);
    expect((await env.arrayBuffer()).byteLength).toBe(7);
    await expect(env.text()).resolves.toBe("GEOTIFF");
  });

  it("gives each arrayBuffer() caller its own copy", async () => {
    const env = envelope("abc");
    const first = await env.arrayBuffer();
    new Uint8Array(first)[0] = 0;
    expect(await env.text()).toBe("abc");
  });

  it("falls back to UTF-8 when the declared charset is not a known label", async () => {
    const env = envelope("caf\u00e9", {
      headers: { "content-type": "text/plain; charset=totally-made-up" },
    });
    await expect(env.text()).resolves.toBe("caf\u00e9");
  });

  it("decodes using the declared charset", async () => {
    const bytes = new Uint8Array([0xe9, 0x63, 0x68, 0x6f]); // "écho" in latin1
    const env = envelope(bytes, { headers: { "content-type": "text/plain; charset=iso-8859-1" } });
    await expect(env.text()).resolves.toBe("écho");
  });
});

describe("the buffer limit", () => {
  const big = "x".repeat(200);
  const init: ResponseInit = {
    headers: { "content-type": "application/json", "content-length": "200" },
  };

  it("defaults to something a process result can exceed but a job document cannot", () => {
    expect(DEFAULT_MAX_BUFFER_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it("exposes only blob() above the limit", async () => {
    const env = createEnvelope(new Response(big, init), {
      requestedUrl: BASE,
      maxBufferBytes: 100,
    });

    expect(env.bodyTooLarge).toBe(true);
    await expect(env.json()).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(env.text()).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(env.arrayBuffer()).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(env.blob()).resolves.toHaveProperty("size", 200);
  });

  it("buffers normally at or below the limit", async () => {
    const env = createEnvelope(new Response(big, init), {
      requestedUrl: BASE,
      maxBufferBytes: 200,
    });
    expect(env.bodyTooLarge).toBe(false);
    await expect(env.text()).resolves.toHaveLength(200);
  });

  it("cannot guard a body that declares no length", async () => {
    const env = createEnvelope(new Response(big, { headers: { "content-type": "text/plain" } }), {
      requestedUrl: BASE,
      maxBufferBytes: 1,
    });
    expect(env.bodyTooLarge).toBe(false);
    await expect(env.text()).resolves.toHaveLength(200);
  });
});
