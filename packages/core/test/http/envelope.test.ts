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

  it("reads zero delta-seconds as zero, not as absent", () => {
    // The envelope reports what the server sent. Deciding that zero is too
    // eager to obey is the poll loop's job — see MIN_RETRY_AFTER_MS — and
    // collapsing it to `undefined` here would destroy the evidence first.
    expect(envelope(null, { headers: { "retry-after": "0" } }).retryAfterMs).toBe(0);
  });

  // Finding 0045. Each of these used to fall through the delta-seconds test
  // into `Date.parse`, which reads "-5" and "1.5" as years in 2001 — already
  // elapsed, so they clamped to 0 and were honoured as "retry immediately".
  // A number the sender got wrong is a broken header, never a date.
  it.each([
    ["negative", "-5"],
    ["fractional", "1.5"],
    ["explicitly signed", "+5"],
    ["exponential", "1e3"],
    ["hexadecimal", "0x10"],
    ["leading point", ".5"],
  ])("ignores a %s Retry-After rather than reading it as a date", (_label, raw) => {
    expect(envelope(null, { headers: { "retry-after": raw } }).retryAfterMs).toBeUndefined();
  });

  it("ignores an empty Retry-After", () => {
    expect(envelope(null, { headers: { "retry-after": "   " } }).retryAfterMs).toBeUndefined();
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

  /** A chunked body: no Content-Length, `chunks` pushed on demand, cancellation seen. */
  function chunked(chunks: readonly Uint8Array[]): { response: Response; pulled: () => number } {
    let next = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[next];
        next += 1;
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    });
    return {
      response: new Response(stream, { headers: { "content-type": "application/geo+json" } }),
      pulled: () => next,
    };
  }

  const kilobyte = new Uint8Array(1024).fill(0x78);

  it("counts a body that declares no length, and stops reading at the limit", async () => {
    const { response, pulled } = chunked(Array.from({ length: 50 }, () => kilobyte));
    const env = createEnvelope(response, { requestedUrl: BASE, maxBufferBytes: 4 * 1024 });

    expect(env.bodyTooLarge).toBe(false);
    const error: unknown = await env.text().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BodyTooLargeError);
    expect(error).toMatchObject({ contentLength: undefined, limit: 4096, bytesRead: 5 * 1024 });
    // The fifth chunk crossed the limit; the stream was cancelled, not drained.
    expect(pulled()).toBeLessThan(10);
  });

  it("refuses every reader once the count has passed the limit, blob() included", async () => {
    const { response } = chunked([kilobyte, kilobyte, kilobyte]);
    const env = createEnvelope(response, { requestedUrl: BASE, maxBufferBytes: 2048 });

    await expect(env.json()).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(env.text()).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(env.arrayBuffer()).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(env.blob()).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("reads a body that declares no length at exactly the limit", async () => {
    const { response } = chunked([kilobyte, kilobyte]);
    const env = createEnvelope(response, { requestedUrl: BASE, maxBufferBytes: 2048 });
    expect((await env.arrayBuffer()).byteLength).toBe(2048);
  });

  it("catches a Content-Length that understates the body", async () => {
    const env = createEnvelope(
      new Response(big, { headers: { "content-type": "text/plain", "content-length": "10" } }),
      { requestedUrl: BASE, maxBufferBytes: 100 },
    );
    expect(env.bodyTooLarge).toBe(false);
    await expect(env.text()).rejects.toMatchObject({ contentLength: 10, limit: 100 });
  });

  it("counts bytes, not characters", async () => {
    const env = createEnvelope(
      new Response("é".repeat(60), { headers: { "content-type": "text/plain" } }),
      { requestedUrl: BASE, maxBufferBytes: 100 },
    );
    await expect(env.text()).rejects.toMatchObject({ bytesRead: 120 });
  });

  it("admits PDOK's 1.08 MB chunked page under the default limit", async () => {
    // The page breinstein-buildings links to, 2026-09-26: 1 082 394 bytes of
    // chunked GeoJSON (fixtures README, `pdok/`).
    const size = 1_082_394;
    const chunks = Array.from({ length: Math.ceil(size / 16_384) }, (_, index) =>
      new Uint8Array(Math.min(16_384, size - index * 16_384)).fill(0x20),
    );
    const env = createEnvelope(chunked(chunks).response, { requestedUrl: BASE });
    expect((await env.arrayBuffer()).byteLength).toBe(size);
  });

  it("reads a response with no body as empty", async () => {
    const env = createEnvelope(new Response(null, { status: 204 }), { requestedUrl: BASE });
    await expect(env.text()).resolves.toBe("");
  });
});
