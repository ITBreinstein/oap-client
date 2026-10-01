// @vitest-environment node
/**
 * Review 2026-09-30: `"relay": { "url": "/" }` is accepted and becomes the
 * empty string. The page then has no relay (`createJobSession("")` makes
 * none, `relayAvailable` is false) but also shows neither the fallback warning
 * nor the static-only line, which App shows only for `relayUrl === undefined`.
 */

import { describe, expect, it } from "vitest";
import { checkRuntimeConfig } from "../../src/config/runtime-config.js";

describe("review: relay.url of /", () => {
  it.fails("W24: is refused, or kept as a usable relay address", () => {
    const checked = checkRuntimeConfig({ relay: { url: "/" } });
    if (checked.ok) expect(checked.config.relayUrl).not.toBe("");
    else expect(checked.problem).toMatch(/relay/);
  });
});
