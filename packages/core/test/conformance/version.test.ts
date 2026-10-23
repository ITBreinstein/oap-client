/**
 * Choosing the version of Part 1 to speak, from the conformance declaration —
 * every case of the brief's 4.1, and the two real declarations that matter.
 */

import { describe, expect, it } from "vitest";
import { deriveCapabilities } from "../../src/conformance/capabilities.js";
import { parseConformance } from "../../src/conformance/parse.js";
import { chooseProtocolVersion, declaredCoreVersions } from "../../src/conformance/version.js";
import { isProtocolVersionPreference } from "../../src/vocabulary/protocol-version.js";
import pygeoapi from "../fixtures/pygeoapi/conformance.json" with { type: "json" };
import weaver from "../fixtures/weaver/conformance.json" with { type: "json" };

const URL_OF = "https://service.test/conformance";

function declaring(...uris: string[]) {
  return parseConformance({ conformsTo: uris }, URL_OF);
}

const V1 = "http://www.opengis.net/spec/ogcapi-processes-1/1.0/conf/core";
/** As the draft's own text writes it (`clause_2_conformance.adoc:96`). */
const V2_HTTPS = "https://www.opengis.net/spec/ogcapi-processes-1/2.0/conf/core";
/** As the draft's example and Weaver write it. */
const V2_HTTP = "http://www.opengis.net/spec/ogcapi-processes-1/2.0/conf/core";

describe("chooseProtocolVersion", () => {
  it("speaks the draft to a service that declares the draft's Core", () => {
    expect(chooseProtocolVersion(declaring(V2_HTTPS))).toEqual({
      version: "2.0-draft",
      source: "declared",
    });
  });

  it("reads the draft's Core in either scheme", () => {
    expect(chooseProtocolVersion(declaring(V2_HTTP)).version).toBe("2.0-draft");
  });

  it("speaks 1.0 to a service that declares only 1.0's Core", () => {
    expect(chooseProtocolVersion(declaring(V1))).toEqual({ version: "1.0", source: "declared" });
  });

  it("speaks the draft when both are declared, and says both were", () => {
    const parsed = declaring(V1, V2_HTTP);
    expect(chooseProtocolVersion(parsed)).toEqual({ version: "2.0-draft", source: "declared" });
    expect(declaredCoreVersions(parsed)).toEqual(["1.0", "2.0"]);
  });

  it("assumes 1.0 when no Core class is declared", () => {
    const parsed = declaring("http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core");
    expect(chooseProtocolVersion(parsed)).toEqual({ version: "1.0", source: "default" });
  });

  it("assumes 1.0 when there was no conformance document to read", () => {
    expect(chooseProtocolVersion(undefined)).toEqual({ version: "1.0", source: "default" });
  });

  it("does not take another Part's 2.0 Core for Part 1's", () => {
    const parsed = declaring(V1, "http://www.opengis.net/spec/ogcapi-processes-2/2.0/conf/core");
    expect(chooseProtocolVersion(parsed).version).toBe("1.0");
  });

  it("does not take a 2.0 class other than Core as a declaration of the version", () => {
    const parsed = declaring(V1, "http://www.opengis.net/spec/ogcapi-processes-1/2.0/conf/json");
    expect(chooseProtocolVersion(parsed).version).toBe("1.0");
  });

  it("speaks a configured version whatever is declared, and says it was configured", () => {
    expect(chooseProtocolVersion(declaring(V1, V2_HTTP), "1.0")).toEqual({
      version: "1.0",
      source: "configured",
    });
    expect(chooseProtocolVersion(declaring(V1), "2.0-draft")).toEqual({
      version: "2.0-draft",
      source: "configured",
    });
    expect(chooseProtocolVersion(undefined, "2.0-draft").source).toBe("configured");
  });

  it("treats `auto` as no preference", () => {
    expect(chooseProtocolVersion(declaring(V2_HTTP), "auto").source).toBe("declared");
  });
});

describe("the real declarations", () => {
  it("speaks the draft to Weaver, which declares 1.0 and 2.0 Core (captured 2026-10-23)", () => {
    const capabilities = deriveCapabilities(parseConformance(weaver, URL_OF));
    expect(capabilities.protocolVersion).toBe("2.0-draft");
    expect(capabilities.versionSource).toBe("declared");
    expect(capabilities.declaredVersions).toEqual(expect.arrayContaining(["1.0", "2.0"]));
  });

  it("speaks 1.0 to pygeoapi 0.21.0", () => {
    const capabilities = deriveCapabilities(parseConformance(pygeoapi, URL_OF));
    expect(capabilities.protocolVersion).toBe("1.0");
    expect(capabilities.versionSource).toBe("declared");
    expect(capabilities.declaredVersions).toEqual(["1.0"]);
  });

  it("speaks 1.0 to Weaver when pinned to it", () => {
    const capabilities = deriveCapabilities(parseConformance(weaver, URL_OF), "1.0");
    expect(capabilities.protocolVersion).toBe("1.0");
    expect(capabilities.versionSource).toBe("configured");
  });
});

describe("isProtocolVersionPreference", () => {
  it("accepts the three preferences and nothing else", () => {
    for (const value of ["auto", "1.0", "2.0-draft"]) {
      expect(isProtocolVersionPreference(value)).toBe(true);
    }
    for (const value of ["2.0", "1", "", undefined, null, 2]) {
      expect(isProtocolVersionPreference(value)).toBe(false);
    }
  });
});
