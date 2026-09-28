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
 *   `https:` URL, or a path on this site (`/api`). Plain `http:` only on a
 *   loopback host, the one exemption browsers make too, for local development
 *   and CI.
 * - `presets`: services offered on the start screen, each `https:`. Reached
 *   directly, exactly as if the address had been typed.
 *
 * Anything else — a missing file, a file that is not JSON, an unknown member,
 * a value of the wrong shape — is refused whole, and the page runs without
 * the relay and says why. Nothing is half-applied, and nothing is asserted
 * into shape: the file is operator input on a public site.
 */

import { isLoopback } from "../mixed-content.js";

export interface Preset {
  readonly title: string;
  readonly url: string;
}

export interface RuntimeConfig {
  /** The relay's base URL or same-site path; undefined for no relay. */
  readonly relayUrl: string | undefined;
  readonly presets: readonly Preset[];
}

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
    return value.replace(/\/+$/, "");
  }
  const url = plainAbsoluteUrl(value);
  if (url === undefined) return { problem: "relay.url is not a plain absolute URL or path" };
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname))) {
    return value.replace(/\/+$/, "");
  }
  return { problem: "relay.url must be https:, or http: on a loopback host" };
}

function checkPresets(value: unknown): Preset[] | { readonly problem: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { problem: "presets must be a list" };
  const presets: Preset[] = [];
  for (const [index, entry] of value.entries()) {
    const where = `presets[${String(index)}]`;
    if (!isRecord(entry)) return { problem: `${where} must be an object` };
    const extra = unknownMember(entry, ["title", "url"]);
    if (extra !== undefined) return { problem: `${where} has an unknown member "${extra}"` };
    const { title, url } = entry;
    if (typeof title !== "string" || title.trim() === "") {
      return { problem: `${where}.title must be a non-empty string` };
    }
    if (typeof url !== "string") return { problem: `${where}.url must be a string` };
    const parsed = plainAbsoluteUrl(url);
    if (parsed?.protocol !== "https:")
      return { problem: `${where}.url must be a plain https: URL` };
    presets.push({ title: title.trim(), url: url.replace(/\/+$/, "") });
  }
  return presets;
}

/** Check a parsed `config.json`, whole. */
export function checkRuntimeConfig(value: unknown): ConfigCheck {
  if (!isRecord(value)) return { ok: false, problem: "the file must hold a JSON object" };
  const extra = unknownMember(value, ["relay", "presets"]);
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
  return { ok: true, config: { relayUrl, presets } };
}

function fallback(why: string): ConfigLoad {
  return {
    config: STATIC_ONLY,
    warning: `This site's configuration (config.json) ${why}, so the page runs without the relay and without preset services.`,
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
