/**
 * Which version of OGC API - Processes Part 1 to speak to a service: chosen
 * once, from its conformance declaration, **before** anything is sent.
 *
 * Before, because execution is not idempotent. "Fall back to 1.0" cannot mean
 * "try the draft, and resend as 1.0 when that fails": the first attempt may
 * already have started a job. So the fallback is in the choice, not in a retry.
 *
 * The rules, in order:
 *
 * 1. a version the caller configured wins, whatever the service declares;
 * 2. a service that declares the 2.0 draft's Core class is spoken to as the
 *    draft — also when it declares 1.0's as well, which Weaver does;
 * 3. anything else is 1.0, the published standard: a service that declares
 *    1.0's Core, one that declares no Core class, and one whose conformance
 *    document could not be read at all.
 *
 * The URI's scheme does not matter: the draft writes its classes as
 * `https://www.opengis.net/spec/ogcapi-processes-1/2.0/conf/core`, its own
 * example and Weaver as `http://`, and `parseConformanceUri` reads the path
 * only.
 */

import type { ParsedConformance } from "./parse.js";
import {
  DEFAULT_VERSION_CHOICE,
  type ProtocolVersionPreference,
  type VersionChoice,
} from "../vocabulary/protocol-version.js";

const PROCESSES_FAMILY = "ogcapi-processes";
const PROCESSES_PART = 1;

/**
 * The versions of Part 1 whose Core class the service declares, as the URIs
 * write them (`"1.0"`, `"2.0"`), in the order first declared. Recorded beside
 * the choice, so "declared both, spoke 2.0" is visible in the observations.
 */
export function declaredCoreVersions(parsed: ParsedConformance): readonly string[] {
  const versions: string[] = [];
  for (const klass of parsed.classes) {
    if (klass.family !== PROCESSES_FAMILY || klass.part !== PROCESSES_PART) continue;
    if (klass.name !== "core" || versions.includes(klass.version)) continue;
    versions.push(klass.version);
  }
  return Object.freeze(versions);
}

/**
 * The version to speak, and why. Pure: the same declaration and preference
 * always give the same choice.
 *
 * `parsed` is undefined when there was no conformance document to read.
 */
export function chooseProtocolVersion(
  parsed: ParsedConformance | undefined,
  preference: ProtocolVersionPreference = "auto",
): VersionChoice {
  if (preference !== "auto") return { version: preference, source: "configured" };
  if (parsed === undefined) return DEFAULT_VERSION_CHOICE;
  const declared = declaredCoreVersions(parsed);
  if (declared.includes("2.0")) return { version: "2.0-draft", source: "declared" };
  if (declared.includes("1.0")) return { version: "1.0", source: "declared" };
  return DEFAULT_VERSION_CHOICE;
}
