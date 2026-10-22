/**
 * STYLE TRIAL (updated Instrument, #3): the start screen's known services,
 * each listed once and by a name a visitor can read.
 *
 * - A preset and a relay endpoint of the same address are one service: one
 *   row, reached as the relay endpoint, so its background runs can be found.
 * - A relay endpoint is named by the service's own title once this visit has
 *   read it, else by the preset's title it took the place of, else by its key
 *   made readable ("pygeoapi-cors" is "Pygeoapi cors").
 *
 * Nothing in `config.json` or the relay's configuration changes.
 */

import type { Preset } from "../config/runtime-config.js";
import type { RelayEndpoint } from "../relay/contract.js";

function plain(url: string): string {
  return url.replace(/\/+$/, "");
}

/** A configuration key in words: dashes and underscores as spaces, the first letter capital. */
export function humaniseKey(key: string): string {
  const words = key.replace(/[-_]+/g, " ").trim();
  return words === "" ? key : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * Which relay endpoint each preset gives way to, by the preset's index: one
 * of the same address, the one the relay may also read when there are
 * several, else the first.
 */
export function presetsMerged(
  presets: readonly Preset[],
  configured: readonly RelayEndpoint[],
): ReadonlyMap<number, string> {
  const merged = new Map<number, string>();
  presets.forEach((preset, index) => {
    const same = configured.filter((entry) => plain(entry.baseUrl) === plain(preset.url));
    const chosen = same.find((entry) => entry.readRoute === "relay") ?? same[0];
    if (chosen !== undefined) merged.set(index, chosen.key);
  });
  return merged;
}

/**
 * A relay endpoint's name: the title this visit read from its landing page,
 * the title of a preset it took the place of, or its key in words.
 */
export function endpointName(
  entry: RelayEndpoint,
  readTitle: string | undefined,
  presetTitle: string | undefined,
): string {
  return readTitle ?? presetTitle ?? humaniseKey(entry.key);
}
