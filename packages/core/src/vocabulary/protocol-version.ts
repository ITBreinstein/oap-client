/**
 * The names for which version of OGC API - Processes Part 1 is spoken.
 *
 * Here, below every layer, because both sides need them: `conformance/`
 * chooses a version, and `execution/` records which one a request was sent
 * in. The choosing itself is `conformance/version.ts`; what the 2.0 draft
 * changes on the wire is `compat/processes-2.0-draft.ts`.
 */

/**
 * `"2.0-draft"`, never `"2.0"`: what is spoken is OGC 18-062r3 as of one
 * commit (see `compat/processes-2.0-draft.ts`), not a published standard.
 */
export type ProtocolVersion = "1.0" | "2.0-draft";

/** What a caller may ask for: one of the versions, or `"auto"` to read the declaration. */
export type ProtocolVersionPreference = "auto" | ProtocolVersion;

/**
 * Where the choice came from.
 *
 * - `declared`: the service's conformance document named the version's Core class.
 * - `default`: it named neither, or could not be read, so 1.0 was assumed.
 * - `configured`: the caller pinned it, and the declaration was not consulted.
 */
export type VersionSource = "declared" | "default" | "configured";

export interface VersionChoice {
  readonly version: ProtocolVersion;
  readonly source: VersionSource;
}

/** The 1.0 choice made for want of any evidence. */
export const DEFAULT_VERSION_CHOICE: VersionChoice = Object.freeze({
  version: "1.0",
  source: "default",
});

/** Whether a value is a {@link ProtocolVersionPreference}: for checking configuration. */
export function isProtocolVersionPreference(value: unknown): value is ProtocolVersionPreference {
  return value === "auto" || value === "1.0" || value === "2.0-draft";
}
