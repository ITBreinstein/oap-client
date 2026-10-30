/**
 * The page's side of the version: a pin from config.json's presets, the
 * Developer section's line, and the one choice the 2.0 draft rules out.
 */

import { DraftUnsupportedRequestError, type ServiceCapabilities } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import {
  linkExpressible,
  NO_LINK_IN_DRAFT,
  pinFor,
  versionNote,
  withPin,
} from "../../src/app/protocol-version.js";
import { relayEndpointFor, runError } from "../../src/app/run.js";
import type { EndpointRef } from "../../src/app/workflow.js";
import type { FormPlan } from "../../src/forms/plan.js";

const PRESETS = [
  { title: "Weaver as 1.0", url: "http://localhost:5100/", protocolVersion: "1.0" as const },
  { title: "Unpinned", url: "https://b.example.org" },
];

function capabilities(overrides: Partial<ServiceCapabilities>): ServiceCapabilities {
  return {
    sync: true,
    async: true,
    dismiss: false,
    callback: false,
    jobList: false,
    protocolVersion: "1.0",
    versionSource: "declared",
    declaredVersions: ["1.0"],
    rawConformance: [],
    ...overrides,
  };
}

describe("pinFor and withPin", () => {
  it("finds the pin of the preset of the same address, trailing slash or not", () => {
    expect(pinFor("http://localhost:5100", PRESETS)).toBe("1.0");
    expect(pinFor("https://b.example.org", PRESETS)).toBeUndefined();
    expect(pinFor("https://elsewhere.example.org", PRESETS)).toBeUndefined();
  });

  it("pins a relay endpoint of that address as well as a typed one", () => {
    const configured: EndpointRef = {
      source: "configured",
      key: "weaver",
      baseUrl: "http://localhost:5100",
      executeRoute: "relay",
      readRoute: "relay",
      callbacks: false,
    };
    expect(withPin(configured, PRESETS).protocolVersion).toBe("1.0");
    expect(withPin({ source: "typed", baseUrl: "http://localhost:5100" }, PRESETS)).toEqual({
      source: "typed",
      baseUrl: "http://localhost:5100",
      protocolVersion: "1.0",
    });
  });

  it("leaves an unpinned endpoint exactly as it was", () => {
    const typed: EndpointRef = { source: "typed", baseUrl: "https://b.example.org" };
    expect(withPin(typed, PRESETS)).toBe(typed);
  });

  it("is carried to the relay's view of the endpoint, which every client is made from", () => {
    const pinned = withPin({ source: "typed", baseUrl: "http://localhost:5100" }, PRESETS);
    expect(relayEndpointFor(pinned).protocolVersion).toBe("1.0");
    expect(
      relayEndpointFor({ source: "typed", baseUrl: "https://b.example.org" }),
    ).not.toHaveProperty("protocolVersion");
  });
});

describe("linkExpressible", () => {
  it("is off for a service spoken to as the 2.0 draft, and on for 1.0", () => {
    expect(linkExpressible(capabilities({ protocolVersion: "2.0-draft" }))).toBe(false);
    expect(linkExpressible(capabilities({ protocolVersion: "1.0" }))).toBe(true);
  });

  it("says why in the words the brief gives", () => {
    expect(NO_LINK_IN_DRAFT).toBe(
      "This service's version of the standard doesn't let the page ask for a link instead of the data.",
    );
  });
});

describe("versionNote", () => {
  it("says the version and why, for each source", () => {
    expect(
      versionNote(
        capabilities({
          protocolVersion: "2.0-draft",
          versionSource: "declared",
          declaredVersions: ["1.0", "2.0"],
        }),
      ),
    ).toBe("Speaking OGC API - Processes 2.0 (draft): the service declares 1.0 and 2.0.");
    expect(versionNote(capabilities({}))).toBe(
      "Speaking OGC API - Processes 1.0: the service declares it.",
    );
    expect(versionNote(capabilities({ versionSource: "configured" }))).toBe(
      "Speaking OGC API - Processes 1.0: pinned in config.json.",
    );
    expect(versionNote(capabilities({ versionSource: "default", declaredVersions: [] }))).toBe(
      "Speaking OGC API - Processes 1.0: the service declares no version, so the published standard.",
    );
  });
});

describe("runError for a request the draft cannot express", () => {
  it("says it was not sent, with the core's reason as the detail", () => {
    const error = runError(
      new DraftUnsupportedRequestError("reference", "no-transmission-mode", ["area"]),
      { fields: [] } as unknown as FormPlan,
    );
    expect(error.title).toBe(
      "Not sent: this service's version of the standard can't express this request.",
    );
    expect(error.detail).toContain("transmissionMode");
  });
});
