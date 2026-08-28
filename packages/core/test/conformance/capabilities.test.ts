/**
 * Conformance parsing and capability derivation. Tests 13-16 of the task brief.
 *
 * The `conformsTo` array used here is the one pygeoapi 0.21.0 actually sent on
 * 2026-08-26, captured in `test/fixtures/pygeoapi/conformance.json`. It is not
 * the list in the brief, and the difference is the point — see the
 * "under-advertisement" test at the bottom.
 */

import { describe, expect, it } from "vitest";
import fixture from "../fixtures/pygeoapi/conformance.json" with { type: "json" };
import { deriveCapabilities, unknownCapabilities } from "../../src/conformance/capabilities.js";
import { parseConformance, parseConformanceUri } from "../../src/conformance/parse.js";
import { MalformedDocumentError } from "../../src/errors.js";

const URL_OF = "https://x.test/conformance";
const SPEC = "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf";

/** The full Part 1 v1.0 class list, per 18-062r2 Table 8. */
const FULL_V1 = [
  `${SPEC}/core`,
  `${SPEC}/ogc-process-description`,
  `${SPEC}/json`,
  `${SPEC}/html`,
  `${SPEC}/oas30`,
  `${SPEC}/job-list`,
  `${SPEC}/callback`,
  `${SPEC}/dismiss`,
];

function capabilitiesFor(conformsTo: readonly unknown[]) {
  return deriveCapabilities(parseConformance({ conformsTo }, URL_OF));
}

describe("parseConformanceUri", () => {
  it("splits a URI into family, part, version and class name", () => {
    expect(parseConformanceUri(`${SPEC}/core`)).toEqual({
      uri: `${SPEC}/core`,
      family: "ogcapi-processes",
      part: 1,
      version: "1.0",
      name: "core",
    });
  });

  it("keeps a multi-segment class name whole", () => {
    const uri = "http://www.opengis.net/spec/ogcapi-processes-2/1.0/conf/deploy/replace";
    expect(parseConformanceUri(uri)?.name).toBe("deploy/replace");
  });

  it("returns undefined for a URI that is not shaped like a conformance class", () => {
    expect(parseConformanceUri("not a uri at all")).toBeUndefined();
    expect(parseConformanceUri("https://example.org/some/other/thing")).toBeUndefined();
    expect(parseConformanceUri("http://www.opengis.net/spec/nopart/1.0/conf/core")).toBeUndefined();
  });
});

describe("capability derivation", () => {
  it("derives every capability from a full Part 1 v1.0 conformsTo array", () => {
    const capabilities = capabilitiesFor(FULL_V1);

    expect(capabilities).toMatchObject({
      sync: true,
      async: true,
      dismiss: true,
      callback: true,
    });
    expect(capabilities.rawConformance).toEqual(FULL_V1);
  });

  it("reports dismiss as false when the class is omitted, and changes nothing else", () => {
    const withoutDismiss = FULL_V1.filter((uri) => !uri.endsWith("/dismiss"));
    const capabilities = capabilitiesFor(withoutDismiss);

    // Nothing throws. A missing optional class greys out a button; it must
    // never gate the core, because servers under-advertise in the wild.
    expect(capabilities.dismiss).toBe(false);
    expect(capabilities.sync).toBe(true);
    expect(capabilities.async).toBe(true);
    expect(capabilities.callback).toBe(true);
  });

  it("recognises a v2-shaped URI as the same class at a different version", () => {
    // The guard against whole-string matching. If the parser compared complete
    // URIs against a hardcoded v1 list, this array would derive nothing and a
    // v2 service would silently read as supporting nothing at all.
    const v2 = [
      "http://www.opengis.net/spec/ogcapi-processes-1/2.0/conf/core",
      "http://www.opengis.net/spec/ogcapi-processes-1/2.0/conf/dismiss",
    ];
    const parsed = parseConformance({ conformsTo: v2 }, URL_OF);

    expect(parsed.classes.map((klass) => klass.version)).toEqual(["2.0", "2.0"]);
    expect(parsed.unparseable).toEqual([]);
    expect(deriveCapabilities(parsed)).toMatchObject({ sync: true, async: true, dismiss: true });
  });

  it("ignores another specification family's core class", () => {
    // ogcapi-common-1/1.0/conf/core is not Processes core. pygeoapi sends it.
    const capabilities = capabilitiesFor([
      "http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core",
    ]);
    expect(capabilities.sync).toBe(false);
    expect(capabilities.async).toBe(false);
  });

  it("keeps unparseable URIs in rawConformance", () => {
    const conformsTo = [`${SPEC}/core`, "urn:something:else", "totally not a uri"];
    const parsed = parseConformance({ conformsTo }, URL_OF);

    expect(parsed.classes).toHaveLength(1);
    expect(parsed.unparseable).toEqual(["urn:something:else", "totally not a uri"]);
    // Evidence is never discarded: every string the server sent survives.
    expect(deriveCapabilities(parsed).rawConformance).toEqual(conformsTo);
  });

  it("counts a non-string entry as unparseable without coercing it into raw", () => {
    const parsed = parseConformance({ conformsTo: [`${SPEC}/core`, 42, null] }, URL_OF);
    expect(parsed.raw).toEqual([`${SPEC}/core`]);
    expect(parsed.unparseable).toEqual(["42", "null"]);
  });
});

describe("a broken conformance document", () => {
  it("raises MalformedDocumentError when conformsTo is missing or the wrong type", () => {
    expect(() => parseConformance({}, URL_OF)).toThrow(MalformedDocumentError);
    expect(() => parseConformance({ conformsTo: "core" }, URL_OF)).toThrow(MalformedDocumentError);
    expect(() => parseConformance([], URL_OF)).toThrow(MalformedDocumentError);
    expect(() => parseConformance(null, URL_OF)).toThrow(MalformedDocumentError);
  });

  it("names the URL and the reason, so the message is actionable without a debugger", () => {
    const error = (() => {
      try {
        parseConformance({ conformsTo: 7 }, URL_OF);
        return undefined;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(MalformedDocumentError);
    if (!(error instanceof MalformedDocumentError)) return;
    expect(error.url).toBe(URL_OF);
    expect(error.message).toContain(URL_OF);
    expect(error.reason).toContain("number");
  });
});

describe("unknownCapabilities", () => {
  it("claims nothing at all", () => {
    expect(unknownCapabilities()).toEqual({
      sync: false,
      async: false,
      dismiss: false,
      callback: false,
      rawConformance: [],
    });
  });
});

describe("against the captured pygeoapi 0.21.0 conformance document", () => {
  it("derives what pygeoapi advertises — which is less than it supports", () => {
    const capabilities = deriveCapabilities(parseConformance(fixture, URL_OF));

    expect(capabilities.sync).toBe(true);
    expect(capabilities.async).toBe(true);
    expect(capabilities.callback).toBe(true);

    // The honesty case, verified live on 2026-08-26: `DELETE /jobs/{id}` answers
    // 200 and `GET /jobs` answers 200, yet pygeoapi declares neither the
    // dismiss nor the job-list conformance class. `dismiss: false` therefore
    // means "not declared", never "not supported" — which is exactly why
    // nothing in this layer may gate a request on it.
    expect(capabilities.dismiss).toBe(false);
    expect(capabilities.rawConformance).not.toContain(`${SPEC}/dismiss`);
    expect(capabilities.rawConformance).not.toContain(`${SPEC}/job-list`);
  });

  it("parses every URI pygeoapi sends", () => {
    const parsed = parseConformance(fixture, URL_OF);
    expect(parsed.unparseable).toEqual([]);
    expect(parsed.classes).toHaveLength(fixture.conformsTo.length);
  });
});
