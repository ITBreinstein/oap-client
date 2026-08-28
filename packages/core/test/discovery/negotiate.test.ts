/**
 * Content negotiation and the `?f=json` fallback. Test 17 of the task brief,
 * plus the fallback policy itself.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw.setup.js";
import { createEnvelope } from "../../src/http/envelope.js";
import { MalformedDocumentError, NotJsonError } from "../../src/errors.js";
import { fetchJson, requireJson, withFormatJson } from "../../src/discovery/negotiate.js";

const BASE = "https://service.test/oapi";

function envelopeWith(contentType?: string) {
  const headers = contentType === undefined ? {} : { "content-type": contentType };
  return createEnvelope(new Response("{}", { status: 200, headers }), { requestedUrl: BASE });
}

describe("requireJson", () => {
  it("accepts application/json", () => {
    expect(() => {
      requireJson(envelopeWith("application/json"));
    }).not.toThrow();
  });

  it("accepts a +json structured suffix such as application/geo+json", () => {
    expect(() => {
      requireJson(envelopeWith("application/geo+json"));
    }).not.toThrow();
    expect(() => {
      requireJson(envelopeWith("application/problem+json; charset=utf-8"));
    }).not.toThrow();
  });

  it("rejects text/html, because a 200 HTML landing page is a failure", () => {
    // classify() calls this response `ok` and is right to: nothing went wrong at
    // the HTTP level. Knowing that JSON was asked for is this layer's job.
    const error = (() => {
      try {
        requireJson(envelopeWith("text/html"));
        return undefined;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(NotJsonError);
    if (!(error instanceof NotJsonError)) return;
    expect(error.mediaType).toBe("text/html");
    expect(error.url).toBe(BASE);
    expect(error.message).toContain(BASE);
  });

  it("rejects a response that declared no media type at all", () => {
    expect(() => {
      requireJson(envelopeWith());
    }).toThrow(NotJsonError);
  });
});

describe("withFormatJson", () => {
  it("appends f=json while preserving existing query parameters", () => {
    expect(withFormatJson("https://service.test/oapi?limit=10")).toBe(
      "https://service.test/oapi?limit=10&f=json",
    );
  });

  it("replaces an existing f parameter rather than duplicating it", () => {
    expect(withFormatJson("https://service.test/oapi?f=html")).toBe(
      "https://service.test/oapi?f=json",
    );
  });
});

describe("fetchJson — the fallback policy", () => {
  it("never sends f=json on the first attempt", async () => {
    const seen: string[] = [];
    server.use(
      http.get(BASE, ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );

    const result = await fetchJson(BASE);

    expect(seen).toEqual([BASE]);
    expect(result.usedFormatFallback).toBe(false);
    expect(result.body).toEqual({ ok: true });
  });

  it("states Accept: application/json on every request", async () => {
    const accepts: (string | null)[] = [];
    server.use(
      http.get(BASE, ({ request }) => {
        accepts.push(request.headers.get("accept"));
        return HttpResponse.json({});
      }),
    );

    await fetchJson(BASE);
    expect(accepts).toEqual(["application/json"]);
  });

  it("retries once with f=json when the server ignores Accept and answers HTML", async () => {
    const seen: string[] = [];
    server.use(
      http.get(BASE, ({ request }) => {
        seen.push(request.url);
        return new URL(request.url).searchParams.get("f") === "json"
          ? HttpResponse.json({ rescued: true })
          : HttpResponse.html("<!doctype html><html></html>");
      }),
    );

    const result = await fetchJson(BASE);

    expect(seen).toEqual([BASE, `${BASE}?f=json`]);
    // Recorded, not merely worked around: "ignores Accept, requires f=json" is
    // an interoperability finding and belongs in the matrix.
    expect(result.usedFormatFallback).toBe(true);
    expect(result.body).toEqual({ rescued: true });
  });

  it("fails with NotJsonError when the retry is non-JSON too", async () => {
    server.use(http.get(BASE, () => HttpResponse.html("<!doctype html>")));

    const error = await fetchJson(BASE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotJsonError);
    if (!(error instanceof NotJsonError)) return;
    expect(error.triedFormatFallback).toBe(true);
    expect(error.mediaType).toBe("text/html");
  });

  it("skips the pointless retry when the URL already carried f=json", async () => {
    const seen: string[] = [];
    server.use(
      http.get(BASE, ({ request }) => {
        seen.push(request.url);
        return HttpResponse.html("<!doctype html>");
      }),
    );

    await expect(fetchJson(`${BASE}?f=json`)).rejects.toBeInstanceOf(NotJsonError);
    // An identical second request cannot produce a different answer.
    expect(seen).toEqual([`${BASE}?f=json`]);
  });

  it("does not retry a failing status — that is a ProcessesError, not a format problem", async () => {
    const seen: string[] = [];
    server.use(
      http.get(BASE, ({ request }) => {
        seen.push(request.url);
        return new HttpResponse("<h1>Not Found</h1>", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }),
    );

    const error = await fetchJson(BASE).catch((caught: unknown) => caught);

    expect((error as Error).name).toBe("ProcessesError");
    expect(seen).toEqual([BASE]);
  });

  it("raises MalformedDocumentError when a JSON-labelled body does not parse", async () => {
    server.use(
      http.get(
        BASE,
        () =>
          new HttpResponse("{ this is not json", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const error = await fetchJson(BASE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MalformedDocumentError);
    if (!(error instanceof MalformedDocumentError)) return;
    // The underlying SyntaxError is chained, not swallowed.
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("threads an AbortSignal through and reports the abort as AbortError", async () => {
    server.use(http.get(BASE, () => HttpResponse.json({})));

    const controller = new AbortController();
    controller.abort();

    const error = await fetchJson(BASE, { signal: controller.signal }).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).name).toBe("AbortError");
  });
});
