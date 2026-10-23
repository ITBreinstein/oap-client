/**
 * The page's runtime configuration: `config.json`, served next to
 * `index.html` and read once before the first render.
 *
 * One build, many deployments. The same files run with no relay at all — the
 * static site — or with one, depending only on this file:
 *
 * ```json
 * {
 *   "relay": null,
 *   "presets": [{ "title": "Example", "url": "https://ogc.example.org/api" }]
 * }
 * ```
 *
 * - `relay`: `null` or absent for none. Otherwise `{ "url": … }`, an absolute
 *   `https:` URL, or a path below this site's root (`/api`). Plain `http:`
 *   only on a loopback host, the one exemption browsers make too, for local
 *   development and CI.
 * - `presets`: services offered on the start screen, each `https:`, or
 *   `http:` on `localhost`, `127.0.0.1` or `[::1]`. Reached directly, exactly
 *   as if the address had been typed. Optional: `protocolVersion`, one of
 *   `"auto"`, `"1.0"` or `"2.0-draft"`, pins which version of OGC API -
 *   Processes the page speaks to that address, however it is reached; `"auto"`
 *   or absent reads it from the service's conformance declaration. For
 *   testing a service as the other version.
 * - `examples`: processes offered on the start screen, each opened with one
 *   click: the page connects to `service` and opens `process`. Each has a
 *   `title` and a one-line `summary`; `service` follows the rules for a
 *   preset's `url`. Optional: `needs`, one of `"area"`, `"data"` or
 *   `"values"` (what the process asks of the person running it; left out,
 *   the example shows no tag and is found under "All" only), and
 *   `featured`, `true` to show it on the start screen itself. At most four
 *   are shown there, the first four flagged in file order; more flagged is
 *   not an error. The rest are under "Browse all".
 * - `jobs.acceptedNoticeSeconds`: how long a background job may report
 *   `accepted` before the page says no progress has been reported yet. A
 *   whole number of seconds, 1 to 86 400; 60 when absent.
 * - `map.maxCoordinates`: the most positions one result, or one input, may
 *   have for the page to draw it on the map. Above it the page says so and
 *   offers the download instead. A whole number, 1 to 10 000 000;
 *   {@link DEFAULT_MAX_MAP_COORDINATES} when absent.
 * - `map.maxEditableCoordinates`: the most positions an input may have for
 *   the map to edit it. Above it the input is shown on the map, read-only,
 *   and "Draw on the map" is off for it. A whole number, 1 to 10 000 000;
 *   {@link DEFAULT_MAX_EDITABLE_COORDINATES} when absent.
 *
 * Anything else — a missing file, a file that is not JSON, an unknown member,
 * a value of the wrong shape — is refused whole, and the page runs without
 * the relay and says why. Nothing is half-applied, and nothing is asserted
 * into shape: the file is operator input on a public site.
 */

import {
  isProtocolVersionPreference,
  type ProtocolVersionPreference,
} from "@breinstein/oap-client";
import { isNeeds, type Needs } from "../app/needs.js";
import { isLoopback } from "../mixed-content.js";

export interface Preset {
  readonly title: string;
  readonly url: string;
  /** Pins the version spoken to this address; undefined reads the declaration. */
  readonly protocolVersion?: ProtocolVersionPreference | undefined;
}

/** One process offered on the start screen, opened with one click. */
export interface Example {
  /** The service's base URL, as a preset's. */
  readonly service: string;
  /** The process id on that service. */
  readonly process: string;
  readonly title: string;
  readonly summary: string;
  /** What it asks of the person running it; undefined when the file does not say. */
  readonly needs?: Needs | undefined;
  readonly featured: boolean;
}

export interface RuntimeConfig {
  /** The relay's base URL or same-site path; undefined for no relay. */
  readonly relayUrl: string | undefined;
  readonly presets: readonly Preset[];
  /** `examples`; empty when absent. */
  readonly examples?: readonly Example[] | undefined;
  /** `jobs.acceptedNoticeSeconds`, in milliseconds; undefined for the default. */
  readonly acceptedNoticeMs?: number | undefined;
  /** `map.maxCoordinates`; undefined for {@link DEFAULT_MAX_MAP_COORDINATES}. */
  readonly maxMapCoordinates?: number | undefined;
  /** `map.maxEditableCoordinates`; undefined for {@link DEFAULT_MAX_EDITABLE_COORDINATES}. */
  readonly maxEditableCoordinates?: number | undefined;
}

/**
 * Positions the map draws for one result or input when `config.json` does not
 * say. MapLibre draws this many without the page stalling on an ordinary
 * laptop; what matters more is that past it the page declines and says so,
 * rather than trying and going blank (review W3).
 */
export const DEFAULT_MAX_MAP_COORDINATES = 250_000;

/**
 * Positions the map edits in one input when `config.json` does not say.
 * Editing costs far more than showing: Terra Draw keeps a feature for every
 * vertex (a coordinate point), and a selected shape gets a handle for every
 * vertex too, all redrawn on each move. Measured on an Apple M1 (8 GB) in
 * Chromium, a polygon of 1 000 vertices answers a click in about 120 ms and
 * drags with no task over 100 ms; at 2 000 a click takes about 190 ms and each
 * step of a drag about 165 ms; at 4 000 a click takes 0.76 s. Above the limit
 * the input is shown read-only rather than edited badly.
 */
export const DEFAULT_MAX_EDITABLE_COORDINATES = 1_000;

/** No relay, no presets: what the page runs with when the file cannot be used. */
export const STATIC_ONLY: RuntimeConfig = { relayUrl: undefined, presets: [] };

export type ConfigCheck =
  | { readonly ok: true; readonly config: RuntimeConfig }
  | { readonly ok: false; readonly problem: string };

/** What the page starts with, and what to tell the user about it. */
export interface ConfigLoad {
  readonly config: RuntimeConfig;
  /** Set when the file was missing or refused and the page fell back to {@link STATIC_ONLY}. */
  readonly warning: string | undefined;
}

export const CONFIG_PATH = "/config.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownMember(record: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(record).find((key) => !allowed.includes(key));
}

/** An absolute URL with no userinfo, query or fragment, or undefined. */
function plainAbsoluteUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return undefined;
  }
  return url;
}

function checkRelayUrl(value: unknown): string | { readonly problem: string } {
  if (typeof value !== "string" || value === "") return { problem: "relay.url must be a string" };
  if (value.startsWith("/")) {
    // A path on this site. `//host` would be another site, and a backslash is
    // read as a slash by the URL parser.
    if (value.startsWith("//") || value.includes("\\") || /[?#]/.test(value)) {
      return { problem: "relay.url must be a plain path on this site, such as /api" };
    }
    const path = value.replace(/\/+$/, "");
    // "/" is the page's own address, not a relay's. Taken as one it became the
    // empty string, which the page reads as no relay, with nothing said (W24).
    if (path === "")
      return { problem: "relay.url must be a path below the site root, such as /api" };
    return path;
  }
  const url = plainAbsoluteUrl(value);
  if (url === undefined) return { problem: "relay.url is not a plain absolute URL or path" };
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname))) {
    return value.replace(/\/+$/, "");
  }
  return { problem: "relay.url must be https:, or http: on a loopback host" };
}

/**
 * The hosts a preset may name over plain `http:`: these three exactly, for
 * local development and CI. Narrower than what a browser treats as secure
 * (`isLoopback` also takes `*.localhost` and all of 127.0.0.0/8), on purpose:
 * a preset is offered to every visitor, and these are the only loopback
 * names anything here needs.
 */
const LOOPBACK_PRESET_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

function checkPresets(value: unknown): Preset[] | { readonly problem: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { problem: "presets must be a list" };
  const presets: Preset[] = [];
  for (const [index, entry] of value.entries()) {
    const where = `presets[${String(index)}]`;
    if (!isRecord(entry)) return { problem: `${where} must be an object` };
    const extra = unknownMember(entry, ["title", "url", "protocolVersion"]);
    if (extra !== undefined) return { problem: `${where} has an unknown member "${extra}"` };
    const { title, url, protocolVersion } = entry;
    if (typeof title !== "string" || title.trim() === "") {
      return { problem: `${where}.title must be a non-empty string` };
    }
    if (typeof url !== "string") return { problem: `${where}.url must be a string` };
    const parsed = plainAbsoluteUrl(url);
    const loopback = parsed?.protocol === "http:" && LOOPBACK_PRESET_HOSTS.has(parsed.hostname);
    if (parsed?.protocol !== "https:" && !loopback)
      return { problem: `${where}.url must be a plain https: URL, or http: on a loopback host` };
    if (protocolVersion !== undefined && !isProtocolVersionPreference(protocolVersion)) {
      return { problem: `${where}.protocolVersion must be "auto", "1.0" or "2.0-draft"` };
    }
    presets.push({
      title: title.trim(),
      url: url.replace(/\/+$/, ""),
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
    });
  }
  return presets;
}

/** A non-empty string, trimmed, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function checkExamples(value: unknown): Example[] | { readonly problem: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { problem: "examples must be a list" };
  const examples: Example[] = [];
  for (const [index, entry] of value.entries()) {
    const where = `examples[${String(index)}]`;
    if (!isRecord(entry)) return { problem: `${where} must be an object` };
    const extra = unknownMember(entry, [
      "service",
      "process",
      "title",
      "summary",
      "needs",
      "featured",
    ]);
    if (extra !== undefined) return { problem: `${where} has an unknown member "${extra}"` };
    const { service, needs, featured } = entry;
    if (typeof service !== "string") return { problem: `${where}.service must be a string` };
    if (plainAbsoluteUrl(service)?.protocol !== "https:") {
      return { problem: `${where}.service must be a plain https: URL` };
    }
    const process = text(entry["process"]);
    if (process === undefined) return { problem: `${where}.process must be a non-empty string` };
    const title = text(entry["title"]);
    if (title === undefined) return { problem: `${where}.title must be a non-empty string` };
    const summary = text(entry["summary"]);
    if (summary === undefined) return { problem: `${where}.summary must be a non-empty string` };
    if (needs !== undefined && !isNeeds(needs)) {
      return { problem: `${where}.needs must be "area", "data" or "values"` };
    }
    if (featured !== undefined && typeof featured !== "boolean") {
      return { problem: `${where}.featured must be true or false` };
    }
    examples.push({
      service: service.replace(/\/+$/, ""),
      process,
      title,
      summary,
      ...(needs === undefined ? {} : { needs }),
      featured: featured === true,
    });
  }
  return examples;
}

/** `jobs`, as the notice threshold in milliseconds, or undefined when absent. */
function checkJobs(value: unknown): number | undefined | { readonly problem: string } {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return { problem: "jobs must be an object" };
  const extra = unknownMember(value, ["acceptedNoticeSeconds"]);
  if (extra !== undefined) return { problem: `jobs has an unknown member "${extra}"` };
  const seconds = value["acceptedNoticeSeconds"];
  if (seconds === undefined) return undefined;
  if (
    typeof seconds !== "number" ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 86_400
  ) {
    return { problem: "jobs.acceptedNoticeSeconds must be a whole number from 1 to 86400" };
  }
  return seconds * 1000;
}

/** One of `map`'s limits: a whole number of positions, or undefined when absent. */
function checkLimit(
  map: Record<string, unknown>,
  name: string,
): number | undefined | { readonly problem: string } {
  const limit = map[name];
  if (limit === undefined) return undefined;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10_000_000) {
    return { problem: `map.${name} must be a whole number from 1 to 10000000` };
  }
  return limit;
}

/** `map`, as its two coordinate limits, each undefined when absent. */
function checkMap(
  value: unknown,
):
  | { readonly maxCoordinates?: number | undefined; readonly maxEditable?: number | undefined }
  | { readonly problem: string } {
  if (value === undefined) return {};
  if (!isRecord(value)) return { problem: "map must be an object" };
  const extra = unknownMember(value, ["maxCoordinates", "maxEditableCoordinates"]);
  if (extra !== undefined) return { problem: `map has an unknown member "${extra}"` };
  const maxCoordinates = checkLimit(value, "maxCoordinates");
  if (typeof maxCoordinates === "object") return maxCoordinates;
  const maxEditable = checkLimit(value, "maxEditableCoordinates");
  if (typeof maxEditable === "object") return maxEditable;
  return { maxCoordinates, maxEditable };
}

/** Check a parsed `config.json`, whole. */
export function checkRuntimeConfig(value: unknown): ConfigCheck {
  if (!isRecord(value)) return { ok: false, problem: "the file must hold a JSON object" };
  const extra = unknownMember(value, ["relay", "presets", "examples", "jobs", "map"]);
  if (extra !== undefined) return { ok: false, problem: `unknown member "${extra}"` };

  let relayUrl: string | undefined;
  const relay = value["relay"];
  if (relay !== undefined && relay !== null) {
    if (!isRecord(relay)) return { ok: false, problem: "relay must be null or an object" };
    const relayExtra = unknownMember(relay, ["url"]);
    if (relayExtra !== undefined) {
      return { ok: false, problem: `relay has an unknown member "${relayExtra}"` };
    }
    const checked = checkRelayUrl(relay["url"]);
    if (typeof checked !== "string") return { ok: false, ...checked };
    relayUrl = checked;
  }

  const presets = checkPresets(value["presets"]);
  if (!Array.isArray(presets)) return { ok: false, ...presets };

  const examples = checkExamples(value["examples"]);
  if (!Array.isArray(examples)) return { ok: false, ...examples };

  const jobs = checkJobs(value["jobs"]);
  if (typeof jobs === "object") return { ok: false, ...jobs };

  const map = checkMap(value["map"]);
  if ("problem" in map) return { ok: false, problem: map.problem };

  return {
    ok: true,
    config: {
      relayUrl,
      presets,
      ...(examples.length === 0 ? {} : { examples }),
      ...(jobs === undefined ? {} : { acceptedNoticeMs: jobs }),
      ...(map.maxCoordinates === undefined ? {} : { maxMapCoordinates: map.maxCoordinates }),
      ...(map.maxEditable === undefined ? {} : { maxEditableCoordinates: map.maxEditable }),
    },
  };
}

function fallback(why: string): ConfigLoad {
  return {
    config: STATIC_ONLY,
    warning: `This site's configuration (config.json) ${why}, so the page runs without the relay, preset services or examples.`,
  };
}

export type ConfigFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Read and check `config.json`. Never rejects: whatever goes wrong, the page
 * starts static-only and says why.
 */
export async function loadRuntimeConfig(
  fetchImpl: ConfigFetch = (input, init) => fetch(input, init),
): Promise<ConfigLoad> {
  let response: Response;
  try {
    response = await fetchImpl(CONFIG_PATH, { cache: "no-cache", credentials: "omit" });
  } catch {
    return fallback("could not be loaded");
  }
  // A development server answers any unknown path with index.html.
  const mediaType = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (!response.ok || mediaType === "text/html") return fallback("is missing");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    return fallback("is not valid JSON");
  }
  const checked = checkRuntimeConfig(parsed);
  return checked.ok
    ? { config: checked.config, warning: undefined }
    : fallback(`was refused: ${checked.problem}`);
}
