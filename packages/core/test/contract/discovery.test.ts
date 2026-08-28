/**
 * Discovery against the reference server: pygeoapi 0.21.0, pinned in
 * infra/compose/pygeoapi.yml. Tests 19-23 of the task brief.
 *
 * Every expectation here was derived from what the running server actually
 * sends — captured under `test/fixtures/pygeoapi/` on 2026-08-26 — not from the
 * specification. Where the two disagree, the disagreement is asserted, because
 * that is precisely what the findings report needs.
 */

import { beforeAll, describe, expect, it } from "vitest";
import landingFixture from "../fixtures/pygeoapi/landing-page.json" with { type: "json" };
import conformanceFixture from "../fixtures/pygeoapi/conformance.json" with { type: "json" };
import { createClient } from "../../src/index.js";
import { parseConformance } from "../../src/conformance/parse.js";
import { fetchJson, requireJson } from "../../src/discovery/negotiate.js";
import { NotJsonError } from "../../src/errors.js";
import { classify } from "../../src/http/classify.js";
import { inspect } from "../../src/discovery/inspect.js";
import { findLink } from "../../src/links/find.js";
import { send } from "../../src/http/transport.js";
import type { Observation } from "../../src/observations.js";

const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";

beforeAll(async () => {
  try {
    await send(CORS, { signal: AbortSignal.timeout(5000) });
  } catch (cause) {
    throw new Error(
      `pygeoapi is not answering on ${CORS}. Start it with:\n` +
        `  docker compose -f infra/compose/pygeoapi.yml up -d --wait`,
      { cause },
    );
  }
});

describe("the landing page", () => {
  it("fetches, validates as JSON, and yields a resolvable conformance link", async () => {
    const service = await inspect(CORS);

    const conformance = findLink(service.links, "conformance");
    expect(conformance).toBeDefined();
    expect(conformance?.href).toBe(`${CORS}/conformance`);
    expect(conformance?.type).toBe("application/json");

    // It resolves to something real, which is the part a fixture cannot prove.
    const document = await fetchJson(conformance?.href ?? "");
    expect(document.envelope.status).toBe(200);
  });

  it("advertises conformance short and processes long — the alias table earns its keep", async () => {
    // The single most important step-zero finding. OGC API - Processes Part 1
    // v1.0 §5.2 makes the *long* URI normative for both relations. pygeoapi
    // sends the short name for conformance and the long URI for processes, on
    // the same document. Matching on either form alone finds one and misses the
    // other, and the one it misses is the endpoint we actually need.
    const rels = landingFixture.links.map((link) => link.rel);
    expect(rels).toContain("conformance");
    expect(rels).not.toContain("http://www.opengis.net/def/rel/ogc/1.0/conformance");
    expect(rels).toContain("http://www.opengis.net/def/rel/ogc/1.0/processes");
    expect(rels).not.toContain("processes");

    // And the resolver finds both anyway.
    const service = await inspect(CORS);
    expect(findLink(service.links, "conformance")?.href).toBe(`${CORS}/conformance`);
    expect(findLink(service.links, "processes")?.href).toBe(`${CORS}/processes`);
  });

  it("still matches the captured fixture, so an upstream change is a test failure", async () => {
    const document = await fetchJson(CORS);
    expect(document.body).toEqual(landingFixture);
  });
});

describe("the conformance document", () => {
  it("fetches and parses, and matches the captured fixture", async () => {
    const document = await fetchJson(`${CORS}/conformance`);
    expect(document.body).toEqual(conformanceFixture);

    const parsed = parseConformance(document.body, document.envelope.url);
    expect(parsed.unparseable).toEqual([]);
    expect(parsed.classes).toHaveLength(conformanceFixture.conformsTo.length);
  });

  it("derives the capabilities pygeoapi 0.21 actually advertises", async () => {
    const service = await inspect(CORS);

    expect(service.capabilities).toEqual({
      sync: true,
      async: true,
      callback: true,
      // Not declared. See the under-advertisement test below.
      dismiss: false,
      rawConformance: conformanceFixture.conformsTo,
    });
  });

  it("under-advertises: dismiss and job-list work but are not declared", async () => {
    // Live evidence for §9's claim that capabilities must never gate a request.
    // pygeoapi answers both of these, while declaring neither conformance class.
    const service = await inspect(CORS);
    expect(service.capabilities.dismiss).toBe(false);

    const client = createClient({ baseUrl: CORS });
    const execution = await client.send("processes/hello-world/execution", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "respond-async" },
      body: JSON.stringify({ inputs: { name: "World" } }),
    });
    expect(execution.status).toBe(201);

    // A client that gated DELETE on `capabilities.dismiss` would never send
    // this request, and would never discover that the server supports it.
    const dismissed = await send(execution.location ?? "", { method: "DELETE" });
    expect(dismissed.status).toBe(200);

    expect((await client.send("jobs")).status).toBe(200);
  });
});

describe("content negotiation", () => {
  it("returns HTML for a browser-like Accept header — the trap is real", async () => {
    // The brief predicted this would bite a request sent with *no* Accept
    // header. It does not: Node's fetch defaults to `*/*`, and pygeoapi answers
    // `*/*` with JSON. What triggers HTML is a browser-shaped preference list,
    // which is exactly what the web app will send if the core ever stops
    // setting Accept explicitly. Asserted here so an upgrade cannot change it
    // quietly.
    const browser = await send(CORS, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
      },
    });

    expect(browser.status).toBe(200);
    expect(browser.mediaType).toBe("text/html");
    expect(browser.isJson).toBe(false);
    await expect(browser.text()).resolves.toContain("<!doctype html>");

    // classify() calls this `ok`, quite correctly — nothing went wrong at the
    // HTTP level. Only requireJson() catches it, and this asserts it does so
    // against a real server rather than a hand-built envelope.
    await expect(classify(browser)).resolves.toHaveProperty("kind", "ok");
    expect(() => {
      requireJson(browser);
    }).toThrow(NotJsonError);
  });

  it("answers */* with JSON, so an implicit Accept is not the failure mode", async () => {
    const implicit = await send(CORS, { headers: { Accept: "*/*" } });
    expect(implicit.mediaType).toBe("application/json");
  });

  it("does not need the f=json fallback, because it honours Accept", async () => {
    const observations: Observation[] = [];
    await inspect(CORS, { onObservation: (observation) => observations.push(observation) });

    const landing = observations.find((o) => o.kind === "landing-page-fetched");
    expect(landing).toMatchObject({ usedFormatFallback: false, mediaType: "application/json" });
  });

  it("honours f=json even against a browser-like Accept, so the fallback would work", async () => {
    const overridden = await send(`${CORS}/?f=json`, {
      headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    expect(overridden.mediaType).toBe("application/json");
  });
});

describe("inspect end to end", () => {
  it("returns a populated ServiceDescription against the CORS-enabled port", async () => {
    const service = await createClient({ baseUrl: CORS }).inspect();

    expect(service.url).toBe(`${CORS}/`);
    expect(service.title).toBe("pygeoapi (CORS enabled)");
    expect(service.description).toBe("Reference OGC API - Processes server for the verify lane");
    expect(service.links.length).toBeGreaterThan(0);
    expect(service.capabilities.sync).toBe(true);
  });

  it("returns a populated ServiceDescription against the CORS-disabled port", async () => {
    // Off-browser there is no page origin, so no preflight and nothing to
    // block. The CORS difference between 5080 and 5081 is a browser story only.
    const service = await inspect(NOCORS);

    expect(service.capabilities.rawConformance).toEqual(conformanceFixture.conformsTo);
    expect(findLink(service.links, "processes")?.href).toBe(`${NOCORS}/processes`);
  });

  it("aborts mid-inspect with AbortError and no unhandled rejection", async () => {
    const controller = new AbortController();
    const pending = inspect(CORS, { signal: controller.signal });
    // After the microtask queue drains, the landing-page request is in flight.
    await Promise.resolve();
    controller.abort();

    const error = await pending.catch((caught: unknown) => caught);
    expect((error as Error).name).toBe("AbortError");
  });

  it("threads the signal into the conformance request too, not just the first", async () => {
    // A signal that only reached the first request would let the second run to
    // completion after the user had already moved on.
    const service = await inspect(CORS, { signal: AbortSignal.timeout(15_000) });
    expect(service.capabilities.sync).toBe(true);

    await expect(inspect(CORS, { signal: AbortSignal.timeout(1) })).rejects.toHaveProperty(
      "name",
      "AbortError",
    );
  });
});
