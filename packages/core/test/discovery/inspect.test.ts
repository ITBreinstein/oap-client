/**
 * `inspect()` end to end, over MSW. Test 18 of the task brief, plus the
 * orchestration rules from §10 and the observation contract from §12.
 *
 * The landing page served here is the one pygeoapi 0.21.0 actually sent, with
 * its hosts rewritten — including its real mix of short and long relation
 * forms, which is the thing most likely to break a naive implementation.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw.setup.js";
import conformanceFixture from "../fixtures/pygeoapi/conformance.json" with { type: "json" };
import { inspect } from "../../src/discovery/inspect.js";
import { MalformedDocumentError, NotJsonError } from "../../src/errors.js";
import { findLink } from "../../src/links/find.js";
import type { Observation } from "../../src/observations.js";

const ORIGIN = "https://service.test";
const BASE = `${ORIGIN}/oapi/`;

/** A JSON document, in the shape MSW's `HttpResponse.json` accepts. */
type Document = Record<string, unknown>;

/** pygeoapi's own shape: short `conformance`, long OGC URI for `processes`. */
function landingPage(links?: unknown): Document {
  return {
    title: "pygeoapi (CORS enabled)",
    description: "Reference OGC API - Processes server for the verify lane",
    links: links ?? [
      { rel: "self", type: "application/json", href: `${BASE}?f=json` },
      { rel: "alternate", type: "text/html", href: `${BASE}?f=html` },
      { rel: "conformance", type: "application/json", href: "conformance" },
      {
        rel: "http://www.opengis.net/def/rel/ogc/1.0/processes",
        type: "application/json",
        href: "processes",
      },
    ],
  };
}

function serve(landing: Document, conformance: Document = conformanceFixture) {
  server.use(
    http.get(BASE, () => HttpResponse.json(landing)),
    http.get(`${BASE}conformance`, () => HttpResponse.json(conformance)),
  );
}

function collect(): { sink: (observation: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (observation) => seen.push(observation), seen };
}

describe("inspect", () => {
  it("returns a populated ServiceDescription", async () => {
    serve(landingPage());

    const service = await inspect(BASE);

    expect(service.url).toBe(BASE);
    expect(service.title).toBe("pygeoapi (CORS enabled)");
    expect(service.description).toContain("Reference OGC API - Processes server");
    expect(service.capabilities).toMatchObject({
      sync: true,
      async: true,
      callback: true,
      dismiss: false,
    });
    expect(service.capabilities.rawConformance).toEqual(conformanceFixture.conformsTo);
  });

  it("resolves relative links against the landing page and finds both relation forms", async () => {
    serve(landingPage());

    const service = await inspect(BASE);

    expect(findLink(service.links, "conformance")?.href).toBe(`${BASE}conformance`);
    // Advertised only as the long OGC URI, which is how pygeoapi really does it.
    expect(findLink(service.links, "processes")?.href).toBe(`${BASE}processes`);
  });

  it("prefers the JSON self link over the HTML alternate", async () => {
    serve(landingPage());
    const service = await inspect(BASE);

    expect(findLink(service.links, "alternate")?.type).toBe("text/html");
    expect(findLink(service.links, "self")?.type).toBe("application/json");
  });

  it("merges Link-header links with body links", async () => {
    server.use(
      http.get(BASE, () =>
        HttpResponse.json(landingPage(), {
          headers: { link: '<service-desc.json>; rel="service-desc"; type="application/json"' },
        }),
      ),
      http.get(`${BASE}conformance`, () => HttpResponse.json(conformanceFixture)),
    );

    const service = await inspect(BASE);
    expect(findLink(service.links, "serviceDesc")?.href).toBe(`${BASE}service-desc.json`);
  });
});

describe("inspect — the conformance link", () => {
  it("falls back to ./conformance and records it when none is advertised", async () => {
    const { sink, seen } = collect();
    serve(landingPage([{ rel: "self", type: "application/json", href: `${BASE}?f=json` }]));

    const service = await inspect(BASE, { onObservation: sink });

    expect(service.capabilities.sync).toBe(true);

    const link = seen.find((observation) => observation.kind === "conformance-link");
    expect(link).toMatchObject({ source: "path-fallback", url: `${BASE}conformance` });
  });

  it("resolves the ./conformance fallback under a path prefix, not at the origin root", async () => {
    // A landing page served without a trailing slash. Concatenating
    // `${url}/conformance` would work here, but `new URL("conformance", url)`
    // would drop the prefix — hence the explicit directory normalisation.
    const noSlash = `${ORIGIN}/oapi`;
    const { sink, seen } = collect();
    server.use(
      http.get(noSlash, () => HttpResponse.json({ title: "t", links: [] })),
      http.get(`${noSlash}/conformance`, () => HttpResponse.json(conformanceFixture)),
    );

    const service = await inspect(noSlash, { onObservation: sink });

    expect(seen.find((o) => o.kind === "conformance-link")).toMatchObject({
      url: `${ORIGIN}/oapi/conformance`,
    });
    expect(service.capabilities.sync).toBe(true);
  });

  it("uses the advertised link and says so", async () => {
    const { sink, seen } = collect();
    serve(landingPage());

    await inspect(BASE, { onObservation: sink });

    expect(seen.find((o) => o.kind === "conformance-link")).toMatchObject({
      source: "advertised",
      url: `${BASE}conformance`,
    });
  });
});

describe("inspect — degradation", () => {
  it("degrades to all-false capabilities when the conformance document is missing", async () => {
    const { sink, seen } = collect();
    server.use(
      http.get(BASE, () => HttpResponse.json(landingPage())),
      http.get(`${BASE}conformance`, () => new HttpResponse(null, { status: 404 })),
    );

    // Degraded, not dead: the landing page was fine, so the UI can still list
    // processes. Nothing throws.
    const service = await inspect(BASE, { onObservation: sink });

    expect(service.capabilities).toEqual({
      sync: false,
      async: false,
      dismiss: false,
      callback: false,
      rawConformance: [],
    });
    expect(service.links.length).toBeGreaterThan(0);
    expect(seen.find((o) => o.kind === "conformance-unavailable")).toBeDefined();
  });

  it("degrades when the conformance document is HTML", async () => {
    server.use(
      http.get(BASE, () => HttpResponse.json(landingPage())),
      http.get(`${BASE}conformance`, () => HttpResponse.html("<!doctype html>")),
    );

    await expect(inspect(BASE)).resolves.toHaveProperty("capabilities.sync", false);
  });

  it("degrades when conformsTo is the wrong shape", async () => {
    serve(landingPage(), { conformsTo: "core" });
    await expect(inspect(BASE)).resolves.toHaveProperty("capabilities.rawConformance", []);
  });

  it("survives a landing page whose links member is not an array", async () => {
    serve({ title: "t", links: "nope" });
    const service = await inspect(BASE);
    expect(service.links).toEqual([]);
  });

  it("survives malformed individual links and records each skip", async () => {
    const { sink, seen } = collect();
    serve(landingPage([null, { rel: "conformance", href: "conformance" }, { href: "x" }]));

    const service = await inspect(BASE, { onObservation: sink });

    expect(service.links).toHaveLength(1);
    expect(seen.filter((o) => o.kind === "link-skipped")).toHaveLength(2);
  });
});

describe("inspect — the landing page itself is fatal", () => {
  it("throws NotJsonError when the landing page is HTML even after f=json", async () => {
    server.use(http.get(BASE, () => HttpResponse.html("<!doctype html><html></html>")));
    await expect(inspect(BASE)).rejects.toBeInstanceOf(NotJsonError);
  });

  it("throws MalformedDocumentError when the landing page is not a JSON object", async () => {
    server.use(http.get(BASE, () => HttpResponse.json([1, 2, 3])));
    await expect(inspect(BASE)).rejects.toBeInstanceOf(MalformedDocumentError);
  });

  it("throws ProcessesError when the landing page is a server error", async () => {
    server.use(http.get(BASE, () => new HttpResponse("boom", { status: 500 })));
    const error = await inspect(BASE).catch((caught: unknown) => caught);
    expect((error as Error).name).toBe("ProcessesError");
  });
});

describe("inspect — cancellation", () => {
  it("aborts with AbortError and leaves no unhandled rejection", async () => {
    serve(landingPage());

    const controller = new AbortController();
    controller.abort();

    const error = await inspect(BASE, { signal: controller.signal }).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).name).toBe("AbortError");
  });

  it("propagates an abort raised during the conformance fetch rather than degrading", async () => {
    // The degradation path must not swallow a cancellation: a user who
    // corrected a mistyped URL would otherwise get a bogus all-false result
    // from the request they already abandoned.
    const controller = new AbortController();
    server.use(
      http.get(BASE, () => HttpResponse.json(landingPage())),
      http.get(`${BASE}conformance`, () => {
        controller.abort();
        return HttpResponse.json(conformanceFixture);
      }),
    );

    const error = await inspect(BASE, { signal: controller.signal }).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).name).toBe("AbortError");
  });
});

describe("inspect — observations", () => {
  it("emits the full sequence, with URLs redacted", async () => {
    const { sink, seen } = collect();
    serve(landingPage());

    await inspect(`${BASE}?apikey=secret-value`, { onObservation: sink });

    expect(seen.map((observation) => observation.kind)).toEqual([
      "landing-page-fetched",
      "conformance-link",
      "conformance-fetched",
      "capabilities-derived",
    ]);

    const serialised = JSON.stringify(seen);
    expect(serialised).not.toContain("secret-value");
    expect(serialised).not.toContain("apikey");
  });

  it("records status, media type, fallback use and redirects on the landing page", async () => {
    const { sink, seen } = collect();
    serve(landingPage());

    await inspect(BASE, { onObservation: sink });

    expect(seen[0]).toMatchObject({
      kind: "landing-page-fetched",
      status: 200,
      mediaType: "application/json",
      usedFormatFallback: false,
      redirected: false,
    });
  });

  it("records the f=json fallback when the server only answers to it", async () => {
    const { sink, seen } = collect();
    server.use(
      http.get(BASE, ({ request }) =>
        new URL(request.url).searchParams.get("f") === "json"
          ? HttpResponse.json(landingPage())
          : HttpResponse.html("<!doctype html>"),
      ),
      http.get(`${BASE}conformance`, () => HttpResponse.json(conformanceFixture)),
    );

    await inspect(BASE, { onObservation: sink });

    expect(seen[0]).toMatchObject({ kind: "landing-page-fetched", usedFormatFallback: true });
  });

  it("records class counts and derived capabilities", async () => {
    const { sink, seen } = collect();
    serve(landingPage(), { conformsTo: [...conformanceFixture.conformsTo, "not-a-uri"] });

    await inspect(BASE, { onObservation: sink });

    expect(seen.find((o) => o.kind === "conformance-fetched")).toMatchObject({
      classCount: conformanceFixture.conformsTo.length,
      unparseableCount: 1,
    });
    expect(seen.find((o) => o.kind === "capabilities-derived")).toMatchObject({
      sync: true,
      async: true,
      callback: true,
      dismiss: false,
    });
  });
});

describe("inspect — the conformance path fallback under a query string", () => {
  it("keeps the path prefix when the f=json fallback leaves a query behind", async () => {
    // The base deliberately has NO trailing slash: that is the only shape where
    // this bites. The ?f=json retry leaves a query on the landing-page URL, and
    // appending a slash to the *string* puts it on the query — leaving the path
    // at /oapi, so the relative reference replaces the last segment and the
    // guess lands at the origin root, silently degrading every capability.
    const noSlash = `${ORIGIN}/oapi`;
    const { sink, seen } = collect();
    server.use(
      http.get(noSlash, ({ request }) =>
        new URL(request.url).searchParams.get("f") === "json"
          ? HttpResponse.json({ title: "t", links: [] })
          : HttpResponse.html("<!doctype html>"),
      ),
      http.get(`${noSlash}/conformance`, () => HttpResponse.json(conformanceFixture)),
    );

    const service = await inspect(noSlash, { onObservation: sink });

    expect(seen[0]).toMatchObject({ kind: "landing-page-fetched", usedFormatFallback: true });
    expect(seen.find((o) => o.kind === "conformance-link")).toMatchObject({
      source: "path-fallback",
      url: `${ORIGIN}/oapi/conformance`,
    });
    expect(service.capabilities.sync).toBe(true);
  });

  it("does not carry the landing page's query onto the conformance guess", async () => {
    const { sink, seen } = collect();
    server.use(
      http.get(`${ORIGIN}/oapi`, () => HttpResponse.json({ title: "t", links: [] })),
      http.get(`${BASE}conformance`, () => HttpResponse.json(conformanceFixture)),
    );

    await inspect(`${ORIGIN}/oapi?apikey=secret-value`, { onObservation: sink });

    const link = seen.find((o) => o.kind === "conformance-link");
    expect(link).toMatchObject({ url: `${BASE}conformance` });
    expect(JSON.stringify(seen)).not.toContain("secret-value");
  });
});

describe("inspect — observation reasons are redacted", () => {
  it("does not copy the error message, which carries the URL and a body preview", async () => {
    const { sink, seen } = collect();
    server.use(
      http.get(BASE, () => HttpResponse.json(landingPage())),
      http.get(
        `${BASE}conformance`,
        () =>
          new HttpResponse("<h1>secret-body-content</h1>", {
            status: 500,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    await inspect(`${BASE}?apikey=secret-value`, { onObservation: sink });

    const unavailable = seen.find((o) => o.kind === "conformance-unavailable");
    expect(unavailable).toBeDefined();
    if (unavailable?.kind !== "conformance-unavailable") return;
    // Enough to act on, nothing that identifies the service or quotes it.
    expect(unavailable.reason).toBe("ProcessesError (status 500)");

    const serialised = JSON.stringify(seen);
    expect(serialised).not.toContain("secret-body-content");
    expect(serialised).not.toContain("secret-value");
  });
});
