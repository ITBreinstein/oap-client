/**
 * Task 8: following an output given by reference — refusals (T7), the route
 * (T4), classification by evidence (T5), Content-Crs (T5) and truncation (T6)
 * — against the bodies the servers and PDOK actually sent (step zero,
 * 2026-09-26), through a fetch that never touches the network.
 */

import type { FetchLike } from "@breinstein/oap-client";
import { describe, expect, it, vi } from "vitest";
import { RelayRouteError } from "../../src/relay/relay-fetch.js";
import { plotStatus } from "../../src/results/plottable.js";
import {
  axisHandling,
  isTruncated,
  loadReference,
  readContentCrs,
  refusal,
  routeFor,
  type LoadOptions,
  type LoadedReference,
} from "../../src/results/reference.js";
import type { RenderableResult } from "../../src/results/renderable.js";
import { httpFixture, responseOf } from "./http-fixtures.js";

const PDOK = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand";
const PYGEOAPI: LoadOptions["endpoint"] = { baseUrl: "http://localhost:5080", reads: "direct" };

/** A fetch answering each URL with a fixture or a function; anything else is a test failure. */
function fakeFetch(
  routes: Record<string, string | (() => Response | Promise<Response>)>,
): FetchLike & { calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch of ${url}`);
    return typeof route === "string" ? responseOf(route) : route();
  }) as FetchLike & { calls: typeof calls };
  fetch.calls = calls;
  return fetch;
}

function asResult(loaded: LoadedReference): RenderableResult {
  return { kind: "reference", outputId: "out", href: "https://x.test/", loaded };
}

describe("refusal (T7)", () => {
  it("refuses anything but http and https before sending", () => {
    for (const href of [
      "data:text/plain,x",
      "javascript:alert(1)",
      "ftp://x.test/a",
      "file:///etc/passwd",
      "relative/path",
    ]) {
      expect(refusal(href, "http:")).toBe("unsupported-scheme");
    }
  });

  it("refuses plain http from an https page, except on loopback as a browser does", () => {
    expect(refusal("http://api.example.test/a", "https:")).toBe("mixed-content");
    expect(refusal("http://localhost:5081/a", "https:")).toBeUndefined();
    expect(refusal("http://127.0.0.1:5081/a", "https:")).toBeUndefined();
    expect(refusal("https://api.example.test/a", "https:")).toBeUndefined();
    expect(refusal("http://api.example.test/a", "http:")).toBeUndefined();
  });

  it("sends nothing for a refused href, and says why", async () => {
    const fetch = fakeFetch({});
    const loaded = await loadReference(
      { href: "http://files.example.test/out.tif" },
      { endpoint: PYGEOAPI, fetch, pageProtocol: "https:" },
    );
    expect(loaded).toMatchObject({ outcome: "mixed-content", route: undefined });
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("the route (T4)", () => {
  const relayFetch: FetchLike = () => Promise.resolve(new Response(""));
  const zoo = { baseUrl: "http://localhost:5090/ogc-api", reads: "relay" as const };

  it("takes the relay only for this endpoint's own URLs, once its reads go through it", () => {
    expect(routeFor("http://localhost:5090/ogc-api/jobs/1/results", zoo, relayFetch)).toBe("relay");
    // ZOO's own reference files sit outside its OGC API base (step zero, Z6).
    expect(routeFor("http://localhost:5090/temp//ZOO_DATA_a.txt", zoo, relayFetch)).toBe("direct");
    expect(routeFor(`${PDOK}/items`, zoo, relayFetch)).toBe("direct");
    expect(
      routeFor("http://localhost:5090/ogc-api/x", { ...zoo, reads: "direct" }, relayFetch),
    ).toBe("direct");
    expect(routeFor("http://localhost:5090/ogc-api/x", zoo, undefined)).toBe("direct");
  });

  it("sends through the read route's fetch when it takes the relay", async () => {
    const url = "http://localhost:5090/ogc-api/files/a.json";
    const relay = fakeFetch({
      [url]: () => Response.json({ type: "Point", coordinates: [5, 52] }),
    });
    const direct = fakeFetch({});
    const loaded = await loadReference(
      { href: url },
      { endpoint: zoo, relayFetch: relay, fetch: direct },
    );
    expect(loaded).toMatchObject({ outcome: "ok", route: "relay", representation: "geojson" });
    expect(relay.calls).toHaveLength(1);
    expect(direct.calls).toHaveLength(0);
  });

  it("reports a relay refusal as a failure with the relay's code, not as CORS", async () => {
    const url = "http://localhost:5090/ogc-api/files/a.json";
    const relay: FetchLike = () =>
      Promise.reject(new RelayRouteError("relay-refused", "method-not-carried"));
    const loaded = await loadReference({ href: url }, { endpoint: zoo, relayFetch: relay });
    expect(loaded).toMatchObject({
      outcome: "failed",
      route: "relay",
      detail: "method-not-carried",
    });
  });

  it("sends no credentials, and asks for the type the link declares", async () => {
    const url = `${PDOK}/items?f=json`;
    const fetch = fakeFetch({ [url]: "pdok/bag-pand-items-default-page.http" });
    await loadReference(
      { href: url, mediaType: "application/geo+json" },
      { endpoint: PYGEOAPI, fetch },
    );
    const init = fetch.calls[0]?.init;
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("Accept")).toBe("application/geo+json, */*;q=0.1");
  });
});

describe("classification by evidence (T5)", () => {
  it("plots PDOK's GeoJSON page, and says it is the first page only (T6)", async () => {
    const url = `${PDOK}/items?f=json&bbox=5.118%2C52.089%2C5.124%2C52.093`;
    const loaded = await loadReference(
      { href: url },
      { endpoint: PYGEOAPI, fetch: fakeFetch({ [url]: "pdok/bag-pand-items-default-page.http" }) },
    );
    expect(loaded).toMatchObject({
      outcome: "ok",
      route: "direct",
      representation: "geojson",
      mediaType: "application/geo+json",
      contentCrs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      axes: "as-is",
      page: { returned: 10, matched: undefined, hasNext: true },
    });
    expect(isTruncated(loaded.page)).toBe(true);
    const status = plotStatus(asResult(loaded));
    expect(status.kind).toBe("plotted");
  });

  it("follows a collection to its GeoJSON items in the same click, asking for GeoJSON", async () => {
    const items = `${PDOK}/items?f=json`;
    const fetch = fakeFetch({
      [PDOK]: "pdok/bag-pand-collection.http",
      [items]: "pdok/bag-pand-items-default-page.http",
    });
    const loaded = await loadReference({ href: PDOK }, { endpoint: PYGEOAPI, fetch });
    expect(loaded).toMatchObject({ outcome: "ok", representation: "collection", itemsUrl: items });
    expect(new Headers(fetch.calls[1]?.init?.headers).get("Accept")).toBe("application/geo+json");
    expect(plotStatus(asResult(loaded)).kind).toBe("plotted");
    // No `limit` added: the honest answer is the server's first page.
    expect(isTruncated(loaded.page)).toBe(true);
  });

  it("reads GeoJSON ZOO serves as application/javascript (finding 0026)", async () => {
    const url = "http://localhost:5090/temp//ZOO_DATA_Buffer_Result_0.js";
    const loaded = await loadReference(
      { href: url },
      {
        endpoint: PYGEOAPI,
        fetch: fakeFetch({ [url]: "zoo-project/execution/buffer-reference-json-file.http" }),
      },
    );
    expect(loaded).toMatchObject({
      outcome: "ok",
      representation: "geojson",
      mediaType: "application/javascript",
    });
  });

  it("keeps text that does not parse as JSON as 'other', with its bytes", async () => {
    const url = "http://localhost:5090/temp//ZOO_DATA_echo_a_0.txt";
    const loaded = await loadReference(
      { href: url },
      {
        endpoint: PYGEOAPI,
        fetch: fakeFetch({ [url]: "zoo-project/execution/echo-reference-a-file.http" }),
      },
    );
    expect(loaded).toMatchObject({
      outcome: "ok",
      representation: "other",
      mediaType: "text/plain",
    });
    expect(await loaded.blob?.text()).toBe("plugfest");
  });

  it("does not try to parse XML: GML is 'other'", async () => {
    const url = "http://localhost:5090/temp//ZOO_DATA_Buffer_Result_0.xml";
    const loaded = await loadReference(
      { href: url },
      {
        endpoint: PYGEOAPI,
        fetch: fakeFetch({ [url]: "zoo-project/execution/buffer-reference-gml-file.http" }),
      },
    );
    expect(loaded).toMatchObject({
      outcome: "ok",
      representation: "other",
      mediaType: "application/xml",
    });
  });

  it("takes an image by its media type", async () => {
    const url = "http://localhost:5081/static/img/logo.png";
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const loaded = await loadReference(
      { href: url },
      {
        endpoint: PYGEOAPI,
        fetch: fakeFetch({
          [url]: () => new Response(png, { headers: { "Content-Type": "image/png" } }),
        }),
      },
    );
    expect(loaded).toMatchObject({ outcome: "ok", representation: "image" });
    expect(loaded.blob?.type).toBe("image/png");
  });

  it("gives an error page's status and its text, never markup to render (ZOO's Apache 500)", async () => {
    const url = "http://localhost:5090/temp//gone";
    const loaded = await loadReference(
      { href: url },
      {
        endpoint: PYGEOAPI,
        fetch: fakeFetch({ [url]: "zoo-project/execution/saga-fractals-in-range-500.http" }),
      },
    );
    expect(loaded).toMatchObject({ outcome: "http-error", status: 500 });
    expect(loaded.detail).toMatch(/^<!DOCTYPE HTML/);
    expect(loaded.geojson).toBeUndefined();
  });
});

describe("Content-Crs (T5)", () => {
  it("strips the angle brackets", () => {
    expect(readContentCrs("<http://www.opengis.net/def/crs/OGC/1.3/CRS84>")).toBe(
      "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    );
    expect(readContentCrs(undefined)).toBeUndefined();
    expect(readContentCrs("<>")).toBeUndefined();
  });

  it("plots CRS84 or no header as is, swaps EPSG:4326, and plots nothing else", () => {
    expect(axisHandling(undefined)).toBe("as-is");
    expect(axisHandling("http://www.opengis.net/def/crs/OGC/1.3/CRS84")).toBe("as-is");
    expect(axisHandling("http://www.opengis.net/def/crs/EPSG/0/4326")).toBe("swapped");
    expect(axisHandling("urn:ogc:def:crs:EPSG::4326")).toBe("swapped");
    expect(axisHandling("http://www.opengis.net/def/crs/EPSG/0/4258")).toBe("not-plotted");
    expect(axisHandling("http://www.opengis.net/def/crs/EPSG/0/28992")).toBe("not-plotted");
  });

  async function loadedWith(key: string, headers: Record<string, string> = {}) {
    const url = `${PDOK}/items?crs=x`;
    return loadReference(
      { href: url },
      { endpoint: PYGEOAPI, fetch: fakeFetch({ [url]: () => responseOf(key, headers) }) },
    );
  }

  it("does not plot PDOK's EPSG:4258, which is latitude first", async () => {
    const loaded = await loadedWith("pdok/bag-pand-items-epsg4258.http");
    expect(loaded.axes).toBe("not-plotted");
    expect(plotStatus(asResult(loaded)).kind).toBe("projected");
  });

  it("does not plot PDOK's RD New", async () => {
    const loaded = await loadedWith("pdok/bag-pand-items-epsg28992.http");
    expect(loaded).toMatchObject({
      axes: "not-plotted",
      contentCrs: "http://www.opengis.net/def/crs/EPSG/0/28992",
    });
    expect(plotStatus(asResult(loaded)).kind).toBe("projected");
  });

  it("swaps latitude-first coordinates labelled EPSG:4326 back onto the Netherlands", async () => {
    // PDOK's 4258 answer is latitude first; relabelled 4326, it is what a
    // server honouring EPSG:4326's axis order would send.
    const loaded = await loadedWith("pdok/bag-pand-items-epsg4258.http", {
      "Content-Crs": "<http://www.opengis.net/def/crs/EPSG/0/4326>",
    });
    expect(loaded.axes).toBe("swapped");
    const status = plotStatus(asResult(loaded));
    if (status.kind !== "plotted") throw new Error(`not plotted: ${status.kind}`);
    const [first] = status.shapes;
    if (first?.type !== "Polygon") throw new Error("expected a polygon");
    const [x = 0, y = 0] = first.coordinates[0]?.[0] ?? [];
    expect(x).toBeCloseTo(5.12, 1);
    expect(y).toBeCloseTo(52.09, 1);
  });
});

describe("truncation (T6)", () => {
  it("is truncated by a next link, or by numberMatched above numberReturned", () => {
    expect(isTruncated({ returned: 10, matched: undefined, hasNext: true })).toBe(true);
    expect(isTruncated({ returned: 10, matched: 25, hasNext: false })).toBe(true);
    expect(isTruncated({ returned: 815, matched: undefined, hasNext: false })).toBe(false);
    expect(isTruncated({ returned: 25, matched: 25, hasNext: false })).toBe(false);
    expect(isTruncated(undefined)).toBe(false);
  });

  it("reads numberMatched from the body", async () => {
    const url = "https://x.test/items";
    const body = {
      type: "FeatureCollection",
      numberMatched: 25,
      numberReturned: 1,
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5, 52] } },
      ],
    };
    const loaded = await loadReference(
      { href: url },
      { endpoint: PYGEOAPI, fetch: fakeFetch({ [url]: () => Response.json(body) }) },
    );
    expect(loaded.page).toEqual({ returned: 1, matched: 25, hasNext: false });
  });
});

describe("failures are outcomes, never exceptions", () => {
  it("reads a request the browser would not complete, cross-origin, as CORS", async () => {
    // jsdom's page is http://localhost:3000; :5081 is another origin.
    vi.stubGlobal("location", new URL("http://localhost:3000/"));
    try {
      const url = "http://localhost:5081/static/img/logo.png";
      const fetch: FetchLike = () => Promise.reject(new TypeError("Failed to fetch"));
      const loaded = await loadReference({ href: url }, { endpoint: PYGEOAPI, fetch });
      expect(loaded).toMatchObject({ outcome: "cors-blocked", route: "direct" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops a chunked body at the buffer limit and keeps nothing", async () => {
    const url = "https://x.test/big.json";
    const chunk = new TextEncoder().encode(" ".repeat(1024));
    const stream = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(chunk);
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    const loaded = await loadReference(
      { href: url },
      { endpoint: PYGEOAPI, fetch: fakeFetch({ [url]: stream }), maxBufferBytes: 4096 },
    );
    expect(loaded).toMatchObject({ outcome: "too-large", blob: undefined, geojson: undefined });
  });

  it("does not read a body whose declared length is over the limit", async () => {
    const url = "https://x.test/big.tif";
    const loaded = await loadReference(
      { href: url },
      {
        endpoint: PYGEOAPI,
        fetch: fakeFetch({
          [url]: () =>
            new Response("x", {
              headers: { "Content-Type": "image/tiff", "Content-Length": "9999" },
            }),
        }),
        maxBufferBytes: 100,
      },
    );
    expect(loaded).toMatchObject({ outcome: "too-large", blob: undefined });
  });

  it("keeps an http-error's body to the preview length", async () => {
    const url = "https://x.test/e";
    const { body } = httpFixture("zoo-project/execution/saga-fractals-in-range-500.http");
    const long = body.repeat(10);
    const loaded = await loadReference(
      { href: url },
      {
        endpoint: PYGEOAPI,
        fetch: fakeFetch({
          [url]: () =>
            new Response(long, { status: 502, headers: { "Content-Type": "text/html" } }),
        }),
      },
    );
    expect(loaded.detail?.length).toBeLessThanOrEqual(500);
  });
});
