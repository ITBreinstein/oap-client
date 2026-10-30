/**
 * Which version of OGC API - Processes the page speaks to a service, as far
 * as the page is concerned: a pin from `config.json`, what to tell a
 * developer, and what the 2.0 draft rules out in the form.
 *
 * The choice itself is the core's (`createClient({ protocolVersion })`); this
 * only hands it a pin and reads the answer back.
 */

import type { ProtocolVersionPreference, ServiceCapabilities } from "@breinstein/oap-client";
import type { Preset } from "../config/runtime-config.js";
import { sameService } from "./address.js";
import type { EndpointRef } from "./workflow.js";

/**
 * Said beside the "Link" choice on a service spoken to as the 2.0 draft, which
 * removed the per-output `transmissionMode` the choice is sent as.
 */
export const NO_LINK_IN_DRAFT =
  "This service's version of the standard doesn't let the page ask for a link instead of the data.";

/** The version a preset of the same address pins, if one does. */
export function pinFor(
  baseUrl: string,
  presets: readonly Preset[],
): ProtocolVersionPreference | undefined {
  return presets.find((preset) => sameService(preset.url, baseUrl))?.protocolVersion;
}

/**
 * The endpoint with the pin of the preset of the same address, whichever way
 * it was reached: from the preset itself, typed, or as a relay endpoint of
 * that address. Unchanged when no preset pins it.
 */
export function withPin(endpoint: EndpointRef, presets: readonly Preset[]): EndpointRef {
  const protocolVersion = pinFor(endpoint.baseUrl, presets);
  return protocolVersion === undefined ? endpoint : { ...endpoint, protocolVersion };
}

/** Whether the form may offer "Link" for an output on this service. */
export function linkExpressible(capabilities: ServiceCapabilities): boolean {
  return capabilities.protocolVersion !== "2.0-draft";
}

const VERSION_WORDS: Readonly<Record<ServiceCapabilities["protocolVersion"], string>> = {
  "1.0": "OGC API - Processes 1.0",
  "2.0-draft": "OGC API - Processes 2.0 (draft)",
};

/** The Developer section's line: the version spoken, and why. */
export function versionNote(capabilities: ServiceCapabilities): string {
  const spoken = VERSION_WORDS[capabilities.protocolVersion];
  const declared = capabilities.declaredVersions;
  switch (capabilities.versionSource) {
    case "configured":
      return `Speaking ${spoken}: pinned in config.json.`;
    case "declared":
      return declared.length > 1
        ? `Speaking ${spoken}: the service declares ${declared.join(" and ")}.`
        : `Speaking ${spoken}: the service declares it.`;
    case "default":
      return `Speaking ${spoken}: the service declares no version, so the published standard.`;
  }
}
