/**
 * ZOO-Project: the second implementation.
 *
 * pygeoapi is one Python codebase, and a matrix with one row cannot tell "this
 * server is non-conformant" apart from "the specification is ambiguous and
 * every implementer read it differently". ZOO is C and CGI behind Apache with
 * an FPM worker, which makes it the most useful possible disagreement partner.
 *
 * This lane reports and never blocks — see .github/workflows/interop.yml — and
 * every test here skips itself when nothing is listening, so `pnpm test:interop`
 * stays green on a laptop with the stack down. Start it with:
 *
 *     ./infra/zoo/zoo.sh up
 *
 * The deployment is a pinned fork rather than upstream ZOO — see
 * infra/zoo/README.md — so findings recorded against it name that fork and its
 * commit, not a ZOO-Project release.
 */

import { describe, expect, it } from "vitest";
import landingFixture from "../fixtures/zoo-project/landing-page.json" with { type: "json" };
import conformanceFixture from "../fixtures/zoo-project/conformance.json" with { type: "json" };
import { createClient } from "../../src/index.js";
import { ProcessesError } from "../../src/http/errors.js";
import { inspect } from "../../src/discovery/inspect.js";
import { findLink } from "../../src/links/find.js";
import { send } from "../../src/http/transport.js";
import { LANDING, ZOO, answering } from "./zoo.js";
import type { Observation } from "../../src/observations.js";

const zooUp = await answering();

const observations: Observation[] = [];
const record = (observation: Observation): void => {
  observations.push(observation);
};

// Collected and asserted on, not written out. Persisting them to the
// `observations/` directory the interop workflow uploads needs a home that is
// not `packages/core`: the package typechecks with `types: []` precisely so a
// `node:fs` import is a compile error, and that rule is not negotiable for a
// convenience in a test. Whoever builds the sink writer owns that decision.

describe.skipIf(!zooUp)("ZOO-Project discovery", () => {
  it("inspects: landing page, conformance, capabilities", async () => {
    const service = await inspect(LANDING, { onObservation: record });

    expect(service.title).toBe("The ZOO-Project OGC WPS Developement Server");
    expect(service.links.length).toBeGreaterThan(0);
    expect(findLink(service.links, "conformance")?.href).toBe(`${ZOO}/conformance`);
    expect(findLink(service.links, "processes")?.href).toBe(`${ZOO}/processes`);
  });

  it("still matches the captured fixtures, so an upstream change is a test failure", async () => {
    const landing = await send(LANDING, { headers: { Accept: "application/json" } });
    await expect(landing.json()).resolves.toEqual(landingFixture);

    const conformance = await send(`${ZOO}/conformance`, {
      headers: { Accept: "application/json" },
    });
    await expect(conformance.json()).resolves.toEqual(conformanceFixture);
  });

  it("writes conformance long and processes long — the mirror image of pygeoapi", () => {
    // This is the cross-check finding 0005 was waiting for. pygeoapi sends the
    // *short* `conformance` and the *long* processes URI on one document; ZOO
    // sends the long form for both. So the short form is not pygeoapi being
    // sloppy in a way we can wait out, and the long form is not universal
    // either: both spellings are live, and the alias table is the only thing
    // that finds this server's conformance link and that one's alike.
    const rels = landingFixture.links.map((link) => link.rel);
    expect(rels).toContain("http://www.opengis.net/def/rel/ogc/1.0/conformance");
    expect(rels).not.toContain("conformance");
    expect(rels).toContain("http://www.opengis.net/def/rel/ogc/1.0/processes");
    expect(rels).not.toContain("processes");

    // Short IANA names on the same document, for the relations IANA registers.
    expect(rels).toContain("self");
    expect(rels).toContain("service-desc");
  });

  it("declares every Part 1 class, including the two pygeoapi omits", async () => {
    const service = await inspect(LANDING, { onObservation: record });

    // pygeoapi answers DELETE /jobs/{id} and GET /jobs while declaring neither
    // class (finding 0006). ZOO declares both. Same two capabilities, opposite
    // honesty — which is why the client probes rather than trusting either.
    expect(service.capabilities).toEqual({
      sync: true,
      async: true,
      dismiss: true,
      callback: true,
      rawConformance: conformanceFixture.conformsTo,
    });
  });
});

describe.skipIf(!zooUp)("ZOO-Project links are configured, not derived from the request", () => {
  it("advertises the authority from oas.cfg rather than the one it was reached on", async () => {
    // ZOO builds every href from `rootUrl` in oas.cfg and never consults the
    // request, so the deployment has to be told which port it is published on;
    // infra/zoo/zoo.sh renders that config per port for exactly this reason.
    // Point the shipped configuration at a non-default port and every advertised
    // link goes to :80 — which breaks link-following clients specifically, the
    // ones doing the more correct thing. See finding 0008.
    const service = await inspect(LANDING, { onObservation: record });

    for (const link of service.links) {
      expect(new URL(link.href).host).toBe("localhost:5090");
    }
  });

  it("sends no CORS headers, for any origin, with cors=true in main.cfg", async () => {
    // Browser story only — off-browser there is no origin and nothing to block.
    // A browser client cannot reach this server directly at all: apps/relay is
    // not an optimisation here, it is the only route. See finding 0009.
    for (const origin of ["http://localhost:5173", "http://localhost", "http://localhost:5090"]) {
      const response = await send(LANDING, { headers: { Origin: origin } });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

describe.skipIf(!zooUp)("content negotiation, the other way round", () => {
  it("answers a browser-shaped Accept with JSON — the pygeoapi trap inverted", async () => {
    // pygeoapi answers this exact header with HTML (finding 0007), which is why
    // the core sets Accept explicitly and has a ?f=json fallback behind it. ZOO
    // ignores Accept entirely and always serves JSON. Both behaviours are
    // wrong in opposite directions, and a client that assumed either one would
    // break on the other.
    const browser = await send(LANDING, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
      },
    });

    expect(browser.status).toBe(200);
    expect(browser.mediaType).toBe("application/json");
    expect(browser.isJson).toBe(true);
  });

  it("serves JSON with no Accept header at all", async () => {
    const implicit = await send(LANDING);
    expect(implicit.mediaType).toBe("application/json");
  });

  it("rejects ?f=json with 400 — the fallback would make things worse, not better", async () => {
    // The core appends ?f=json only when the first response was not JSON. Against
    // ZOO that never happens, so the fallback never fires and nothing breaks
    // today. But it is loaded: were ZOO ever to serve HTML for some Accept, the
    // recovery step would turn a usable response into a 400. Finding 0012.
    const fallback = await send(`${LANDING}?f=json`, { headers: { Accept: "application/json" } });

    expect(fallback.status).toBe(400);
    expect(fallback.isJson).toBe(true);
    await expect(fallback.json()).resolves.toMatchObject({ title: "BadRequest" });
  });
});

describe.skipIf(!zooUp)("what the run observed", () => {
  it("needed no ?f=json fallback: ZOO honours Accept on both documents", async () => {
    // pygeoapi's landing page answers a browser-shaped Accept with HTML
    // (finding 0007). ZOO was asked with the core's own Accept and answered
    // JSON, so the format fallback never fired — recorded here because the
    // matrix column is "did the fallback fire", not "does the server document
    // that it would".
    const seen: Observation[] = [];
    await inspect(LANDING, { onObservation: (observation) => seen.push(observation) });

    expect(seen.find((o) => o.kind === "landing-page-fetched")).toMatchObject({
      usedFormatFallback: false,
      mediaType: "application/json",
      redirected: false,
    });
    expect(seen.find((o) => o.kind === "conformance-fetched")).toMatchObject({
      usedFormatFallback: false,
      unparseableCount: 0,
      classCount: conformanceFixture.conformsTo.length,
    });
    // Advertised, not guessed: the ./conformance path fallback would itself be
    // a finding, and against this server it never has to fire.
    expect(seen.find((o) => o.kind === "conformance-link")).toMatchObject({
      source: "advertised",
    });
  });

  it("accumulated observations across the suite, redacted", () => {
    expect(observations.length).toBeGreaterThan(0);
    // redactUrl strips query and fragment at creation; nothing here should
    // carry either, whatever the server put in its links.
    for (const observation of observations) {
      if ("url" in observation) expect(observation.url).not.toContain("?");
    }
  });
});

describe.skipIf(!zooUp)("the landing page needs its trailing slash", () => {
  it("answers the bare path with 400 and a WPS 1.0 exception report", async () => {
    // `http://host/ogc-api` is what a user pastes. ZOO does not redirect it to
    // `/ogc-api/`; it falls through to the WPS 1.0 handler, which complains
    // about a missing `request` parameter in XML. pygeoapi answers the same
    // shape of URL with its landing page. See finding 0010.
    const bare = await send(ZOO, { headers: { Accept: "application/json" } });

    expect(bare.status).toBe(400);
    expect(bare.mediaType).toBe("text/xml");
    expect(bare.location).toBeUndefined();
    await expect(bare.text()).resolves.toContain("<ows:ExceptionReport");

    // Not an Accept problem, and the ?f=json fallback does not rescue it
    // either: the request never reaches the OGC API handler at all.
    const negotiated = await send(`${ZOO}?f=json`, { headers: { Accept: "application/json" } });
    expect(negotiated.status).toBe(400);
    expect(negotiated.mediaType).toBe("text/xml");
  });

  it("is reachable through createClient, which normalises the slash", async () => {
    // Which entry point you use decides whether this server is reachable:
    // createClient appends the slash, a bare inspect() does not. Worth knowing
    // before someone reports the core as broken against ZOO.
    await expect(inspect(ZOO)).rejects.toThrow(ProcessesError);

    const service = await createClient({ baseUrl: ZOO }).inspect({ onObservation: record });
    expect(service.capabilities.sync).toBe(true);
  });
});
