/**
 * Relation matching and media-type preference. Tests 9-12 of the task brief.
 *
 * Tests 9 and 10 are the ones that matter operationally. Verified against a
 * live pygeoapi 0.21.0 on 2026-08-26: it advertises conformance under the
 * *short* name and processes under the *long* OGC URI, on the same landing
 * page. Either form alone finds one and misses the other.
 */

import { describe, expect, it } from "vitest";
import { MissingLinkError } from "../../src/errors.js";
import { findLink, findLinks, requireLink } from "../../src/links/find.js";
import type { Link } from "../../src/links/types.js";
import { matchesRelation } from "../../src/links/types.js";

const OGC = "http://www.opengis.net/def/rel/ogc/1.0";

describe("relation matching", () => {
  it("finds the short IANA form", () => {
    const links: readonly Link[] = [{ rel: "conformance", href: "https://x.test/conformance" }];
    expect(findLink(links, "conformance")?.href).toBe("https://x.test/conformance");
  });

  it("finds the long OGC URI form", () => {
    // pygeoapi emits processes only in this form. A `link.rel === relation`
    // comparison finds nothing here and the client reports a working service as
    // having no processes endpoint.
    const links: readonly Link[] = [{ rel: `${OGC}/processes`, href: "https://x.test/processes" }];
    expect(findLink(links, "processes")?.href).toBe("https://x.test/processes");
  });

  it("matches case-insensitively, as RFC 8288 requires of registered names", () => {
    expect(matchesRelation("Conformance", "conformance")).toBe(true);
    expect(matchesRelation("  SELF  ", "self")).toBe(true);
    expect(matchesRelation("conformances", "conformance")).toBe(false);
  });

  it("returns undefined rather than throwing when the relation is absent", () => {
    expect(findLink([{ rel: "self", href: "https://x.test/" }], "processes")).toBeUndefined();
  });

  it("findLinks returns every match in document order", () => {
    const links: readonly Link[] = [
      { rel: "alternate", href: "https://x.test/?f=html", type: "text/html" },
      { rel: "self", href: "https://x.test/" },
      { rel: "alternate", href: "https://x.test/?f=jsonld", type: "application/ld+json" },
    ];

    expect(findLinks(links, "alternate").map((link) => link.href)).toEqual([
      "https://x.test/?f=html",
      "https://x.test/?f=jsonld",
    ]);
  });
});

describe("media-type preference", () => {
  it("prefers the application/json link over a text/html sibling", () => {
    const links: readonly Link[] = [
      { rel: "conformance", href: "https://x.test/conformance?f=html", type: "text/html" },
      { rel: "conformance", href: "https://x.test/conformance", type: "application/json" },
    ];

    expect(findLink(links, "conformance")?.href).toBe("https://x.test/conformance");
  });

  it("prefers a +json suffix type over an untyped link", () => {
    const links: readonly Link[] = [
      { rel: "service-desc", href: "https://x.test/a" },
      {
        rel: "service-desc",
        href: "https://x.test/b",
        // Parameters and all: a naive endsWith("+json") misses this one.
        type: "application/vnd.oai.openapi+json;version=3.0",
      },
    ];

    expect(findLink(links, "serviceDesc")?.href).toBe("https://x.test/b");
  });

  it("prefers an untyped link over one that declares a non-JSON type", () => {
    // The reason step 3 outranks step 4: an untyped link is a plausible JSON
    // candidate, whereas text/html is known to be wrong.
    const links: readonly Link[] = [
      { rel: "conformance", href: "https://x.test/html", type: "text/html" },
      { rel: "conformance", href: "https://x.test/unknown" },
    ];

    expect(findLink(links, "conformance")?.href).toBe("https://x.test/unknown");
  });

  it("falls back to the first match when nothing distinguishes the candidates", () => {
    const links: readonly Link[] = [
      { rel: "conformance", href: "https://x.test/one", type: "text/html" },
      { rel: "conformance", href: "https://x.test/two", type: "text/plain" },
    ];

    expect(findLink(links, "conformance")?.href).toBe("https://x.test/one");
  });

  it("treats an unparseable media type as no better informed than an absent one", () => {
    const links: readonly Link[] = [
      { rel: "conformance", href: "https://x.test/broken", type: "!!!not a media type!!!" },
      { rel: "conformance", href: "https://x.test/html", type: "text/html" },
    ];

    expect(findLink(links, "conformance")?.href).toBe("https://x.test/broken");
  });
});

describe("requireLink", () => {
  it("throws MissingLinkError naming both the relation and the document", () => {
    const error = (() => {
      try {
        requireLink([], "processes", "https://x.test/oapi/");
        return undefined;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(MissingLinkError);
    if (!(error instanceof MissingLinkError)) return;
    expect(error.relation).toBe("processes");
    expect(error.url).toBe("https://x.test/oapi/");
    expect(error.message).toContain("https://x.test/oapi/");
  });

  it("returns the link when it is present", () => {
    const links: readonly Link[] = [{ rel: `${OGC}/processes`, href: "https://x.test/processes" }];
    expect(requireLink(links, "processes", "https://x.test/").href).toBe(
      "https://x.test/processes",
    );
  });
});

describe("relation matching — RFC 8288 edge cases", () => {
  it("finds a relation inside a multi-valued rel", () => {
    // RFC 8288 §3.3: rel is a space-separated list. Comparing the whole
    // attribute finds neither value, so a server that marks its conformance
    // link as also being an alternate looks like it has no conformance link.
    expect(matchesRelation("conformance alternate", "conformance")).toBe(true);
    expect(matchesRelation("alternate conformance", "conformance")).toBe(true);
    expect(matchesRelation(`self ${OGC}/processes`, "processes")).toBe(true);
    expect(matchesRelation("conformances alternate", "conformance")).toBe(false);
  });

  it("matches the https variant of an OGC relation URI", () => {
    // The OGC URIs are identifiers, not addresses we fetch. conformance/parse.ts
    // already ignores the scheme; these two must not disagree.
    const links: readonly Link[] = [
      { rel: "https://www.opengis.net/def/rel/ogc/1.0/processes", href: "https://x.test/p" },
    ];
    expect(findLink(links, "processes")?.href).toBe("https://x.test/p");
  });

  it("finds a multi-valued rel through findLink, not just matchesRelation", () => {
    const links: readonly Link[] = [
      { rel: "conformance alternate", href: "https://x.test/c", type: "application/json" },
    ];
    expect(findLink(links, "conformance")?.href).toBe("https://x.test/c");
  });
});
