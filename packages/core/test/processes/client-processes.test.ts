/**
 * The client wiring: `listProcesses()` and `getProcess()` on a *fresh* client,
 * with nobody having called `inspect()` first.
 *
 * That is what the endpoint screen does — paste a URL, see the processes — so
 * "it just works" has to be the behaviour, and the route it took has to be in
 * the observation either way.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw.setup.js";
import conformanceFixture from "../fixtures/pygeoapi/conformance.json" with { type: "json" };
import pygeoapiList from "../fixtures/pygeoapi/process-list.json" with { type: "json" };
import helloWorld from "../fixtures/pygeoapi/processes/hello-world.json" with { type: "json" };
import { createClient } from "../../src/client.js";
import type { Observation } from "../../src/observations.js";

const ORIGIN = "https://service.test";
const BASE = `${ORIGIN}/oapi/`;

function collect(): { sink: (observation: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (observation) => seen.push(observation), seen };
}

/** pygeoapi's own shape: the processes relation only in its long OGC URI form. */
function landing(links?: unknown) {
  return {
    title: "service",
    links: links ?? [
      { rel: "self", type: "application/json", href: `${BASE}?f=json` },
      { rel: "conformance", type: "application/json", href: "conformance" },
      {
        rel: "http://www.opengis.net/def/rel/ogc/1.0/processes",
        type: "application/json",
        href: "processes",
      },
    ],
  };
}

function serveDiscovery(page = landing()) {
  server.use(
    http.get(BASE, () => HttpResponse.json(page)),
    http.get(`${BASE}conformance`, () => HttpResponse.json(conformanceFixture)),
  );
}

describe("client.listProcesses", () => {
  it("discovers the list URL itself on a fresh client", async () => {
    serveDiscovery();
    server.use(http.get(`${BASE}processes`, () => HttpResponse.json(pygeoapiList)));

    const { sink, seen } = collect();
    const list = await createClient({ baseUrl: BASE, onObservation: sink }).listProcesses();

    expect(list.processes[0]?.id).toBe("hello-world");
    expect(seen.find((entry) => entry.kind === "processes-link")).toMatchObject({
      source: "advertised",
      url: `${BASE}processes`,
    });
  });

  it("does not re-run discovery on a second call", async () => {
    let landingRequests = 0;
    server.use(
      http.get(BASE, () => {
        landingRequests += 1;
        return HttpResponse.json(landing());
      }),
      http.get(`${BASE}conformance`, () => HttpResponse.json(conformanceFixture)),
      http.get(`${BASE}processes`, () => HttpResponse.json(pygeoapiList)),
    );

    const client = createClient({ baseUrl: BASE });
    await client.listProcesses();
    await client.listProcesses();

    expect(landingRequests).toBe(1);
  });

  it("falls back to ./processes when the landing page advertises no processes link", async () => {
    serveDiscovery(landing([{ rel: "self", href: `${BASE}?f=json` }]));
    server.use(http.get(`${BASE}processes`, () => HttpResponse.json(pygeoapiList)));

    const { sink, seen } = collect();
    await createClient({ baseUrl: BASE, onObservation: sink }).listProcesses();

    expect(seen.find((entry) => entry.kind === "processes-link")).toMatchObject({
      source: "path-fallback",
    });
  });

  it("still lists when the landing page itself is unusable", async () => {
    // A service can serve HTML at its root and JSON below it. Refusing to list
    // because discovery failed would turn a finding into an outage.
    server.use(
      http.get(BASE, () => HttpResponse.html("<html><body>Welcome</body></html>")),
      http.get(`${BASE}processes`, () => HttpResponse.json(pygeoapiList)),
    );

    const { sink, seen } = collect();
    const list = await createClient({ baseUrl: BASE, onObservation: sink }).listProcesses();

    expect(list.processes[0]?.id).toBe("hello-world");
    expect(seen.find((entry) => entry.kind === "processes-link")).toMatchObject({
      source: "path-fallback",
    });
  });

  it("keeps the base URL's path prefix when it guesses", async () => {
    const client = createClient({ baseUrl: "https://gateway.test/a/b" });
    server.use(
      http.get("https://gateway.test/a/b/", () => HttpResponse.json({ title: "t", links: [] })),
      http.get("https://gateway.test/a/b/conformance", () => HttpResponse.json({ conformsTo: [] })),
      http.get("https://gateway.test/a/b/processes", () => HttpResponse.json(pygeoapiList)),
    );

    await expect(client.listProcesses()).resolves.toMatchObject({ pageCount: 1 });
  });

  it("does not memoise a cancelled discovery", async () => {
    serveDiscovery();
    server.use(http.get(`${BASE}processes`, () => HttpResponse.json(pygeoapiList)));

    const client = createClient({ baseUrl: BASE });
    const controller = new AbortController();
    controller.abort();

    await expect(client.listProcesses({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    // The client is still usable: the failed promise was dropped, not kept.
    await expect(client.listProcesses()).resolves.toMatchObject({ pageCount: 1 });
  });
});

describe("client.getProcess", () => {
  it("resolves the description from a fresh client", async () => {
    serveDiscovery();
    server.use(http.get(`${BASE}processes/hello-world`, () => HttpResponse.json(helloWorld)));

    const process = await createClient({ baseUrl: BASE }).getProcess("hello-world");

    expect(process.inputs.map((input) => input.id)).toEqual(["name", "message"]);
  });

  it("prefers a supplied summary's self link over the constructed path", async () => {
    serveDiscovery();
    server.use(http.get(`${BASE}processes`, () => HttpResponse.json(pygeoapiList)));
    // Only the advertised URL is served, and the fixture's own `self` points at
    // a different origin entirely — pygeoapi builds its hrefs from its
    // configured URL, not from the request (finding 0008's theme). A client
    // that rebuilt `${BASE}processes/hello-world` never reaches this handler.
    server.use(
      http.get("http://localhost:5080/processes/hello-world", () => HttpResponse.json(helloWorld)),
    );

    const client = createClient({ baseUrl: BASE });
    const list = await client.listProcesses();
    const summary = list.processes[0];
    if (summary === undefined) throw new Error("fixture has no processes");

    const process = await client.getProcess(summary.id, { summary });

    expect(process.id).toBe("hello-world");
  });
});
