/**
 * Resolution and merging. Tests 1-8 of the task brief.
 *
 * These are fixture-driven and never touch the network: the envelope is built
 * by hand precisely so that `url` and `requestedUrl` can be made to disagree,
 * which is the case a live server makes hard to arrange on demand.
 */

import { describe, expect, it } from "vitest";
import { createEnvelope } from "../../src/http/envelope.js";
import type { ResponseEnvelope } from "../../src/http/envelope.js";
import { collectLinks, readBodyLinks } from "../../src/links/resolve.js";
import type { Link } from "../../src/links/types.js";
import type { Observation } from "../../src/observations.js";

/**
 * A hand-built envelope. `Response` has no writable `url`, so the served URL is
 * injected through `requestedUrl` and the two are then distinguished by the
 * `servedFrom` override — which is exactly the redirect case under test.
 */
function envelopeFor(servedFrom: string, headers: Record<string, string> = {}): ResponseEnvelope {
  const response = new Response("{}", { status: 200, headers });
  return createEnvelope(response, { requestedUrl: servedFrom });
}

function hrefsOf(links: readonly Link[]): string[] {
  return links.map((link) => link.href);
}

describe("collectLinks — relative resolution", () => {
  it("resolves a relative href against a base with a trailing slash", () => {
    const links = collectLinks(envelopeFor("https://demo.example.nl/oapi/"), [
      { rel: "processes", href: "processes" },
    ]);

    expect(hrefsOf(links)).toEqual(["https://demo.example.nl/oapi/processes"]);
  });

  it("resolves a relative href against a base WITHOUT a trailing slash, per RFC 3986", () => {
    // Not a quirk: without a trailing slash the last segment is a file and is
    // replaced. Documenting it here means nobody later "fixes" the resolver
    // into concatenation and calls the result an improvement.
    const links = collectLinks(envelopeFor("https://demo.example.nl/oapi"), [
      { rel: "processes", href: "processes" },
    ]);

    expect(hrefsOf(links)).toEqual(["https://demo.example.nl/processes"]);
  });

  it("resolves against the post-redirect URL, not the URL that was requested", () => {
    // The user typed /oapi; the server 301'd to /oapi/ and served the landing
    // page there. Resolving against what was typed yields a 404.
    const response = new Response("{}", { status: 200 });
    const envelope = createEnvelope(response, { requestedUrl: "https://demo.example.nl/oapi/" });
    const redirected: ResponseEnvelope = {
      ...envelope,
      requestedUrl: "https://demo.example.nl/oapi",
    };

    expect(redirected.url).not.toBe(redirected.requestedUrl);

    const links = collectLinks(redirected, [{ rel: "processes", href: "processes" }]);
    expect(hrefsOf(links)).toEqual(["https://demo.example.nl/oapi/processes"]);
  });

  it("passes an absolute href through unchanged", () => {
    const links = collectLinks(envelopeFor("https://demo.example.nl/oapi/"), [
      { rel: "processes", href: "https://other.example.nl/api/processes" },
    ]);

    expect(hrefsOf(links)).toEqual(["https://other.example.nl/api/processes"]);
  });

  it("resolves a protocol-relative href against the base's scheme", () => {
    const links = collectLinks(envelopeFor("https://demo.example.nl/oapi/"), [
      { rel: "processes", href: "//other.example.nl/processes" },
    ]);

    expect(hrefsOf(links)).toEqual(["https://other.example.nl/processes"]);
  });
});

describe("collectLinks — merging the two sources", () => {
  it("keeps links from both the Link header and the body", () => {
    const envelope = envelopeFor("https://demo.example.nl/oapi/", {
      link: '<conformance>; rel="conformance"; type="application/json"',
    });

    const links = collectLinks(envelope, [{ rel: "processes", href: "processes" }]);

    expect(links).toHaveLength(2);
    expect(hrefsOf(links)).toEqual(
      expect.arrayContaining([
        "https://demo.example.nl/oapi/conformance",
        "https://demo.example.nl/oapi/processes",
      ]),
    );
  });

  it("collapses a duplicate rel+href, keeping the entry that declares a media type", () => {
    // The header entry is untyped and the body entry declares JSON. Same rel,
    // same resolved href — one link, and it must be the informative one.
    const envelope = envelopeFor("https://demo.example.nl/oapi/", {
      link: "<conformance>; rel=conformance",
    });

    const links = collectLinks(envelope, [
      { rel: "conformance", href: "conformance", type: "application/json" },
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe("https://demo.example.nl/oapi/conformance");
    expect(links[0]?.type).toBe("application/json");
  });
});

describe("collectLinks — malformed entries", () => {
  it("skips bad entries without throwing and keeps the valid siblings", () => {
    const observations: Observation[] = [];
    const bad = [
      "not-an-object",
      42,
      null,
      { rel: "processes" }, // no href
      { href: "processes" }, // no rel
      { rel: "self", href: "http://[" }, // unresolvable
      { rel: "conformance", href: "conformance" }, // the survivor
    ] as unknown as readonly Link[];

    const links = collectLinks(envelopeFor("https://demo.example.nl/oapi/"), bad, (observation) =>
      observations.push(observation),
    );

    expect(hrefsOf(links)).toEqual(["https://demo.example.nl/oapi/conformance"]);

    const reasons = observations.map((observation) =>
      observation.kind === "link-skipped" ? observation.reason : observation.kind,
    );
    expect(reasons).toEqual([
      "not-an-object",
      "not-an-object",
      "not-an-object",
      "missing-href",
      "missing-rel",
      "unresolvable-href",
    ]);
  });

  it("does not let a throwing observation sink break link collection", () => {
    const links = collectLinks(
      envelopeFor("https://demo.example.nl/oapi/"),
      [null, { rel: "self", href: "." }] as unknown as readonly Link[],
      () => {
        throw new Error("the application's logger is broken");
      },
    );

    expect(hrefsOf(links)).toEqual(["https://demo.example.nl/oapi/"]);
  });

  it("returns an empty list rather than throwing when there are no links at all", () => {
    expect(collectLinks(envelopeFor("https://demo.example.nl/oapi/"), undefined)).toEqual([]);
  });

  it("redacts the query string from the document URL it reports", () => {
    const observations: Observation[] = [];
    collectLinks(
      envelopeFor("https://demo.example.nl/oapi/?token=hunter2"),
      [null] as unknown as readonly Link[],
      (observation) => observations.push(observation),
    );

    const first = observations[0];
    expect(first?.kind).toBe("link-skipped");
    if (first?.kind !== "link-skipped") return;
    expect(first.documentUrl).toBe("https://demo.example.nl/oapi/");
    expect(first.documentUrl).not.toContain("hunter2");
  });
});

describe("readBodyLinks", () => {
  it("distinguishes an absent links member from one that is not an array", () => {
    expect(readBodyLinks({ title: "x" })).toBeUndefined();
    expect(readBodyLinks({ links: "nope" })).toEqual([]);
    expect(readBodyLinks({ links: [{ rel: "self", href: "." }] })).toHaveLength(1);
    expect(readBodyLinks("not an object")).toBeUndefined();
  });
});
