/**
 * Playwright's `test`, with a page whose routes are closed before the test
 * ends.
 *
 * A route that forwards a request (`route.fetch()`, then `route.fulfill()`)
 * may still be waiting for the server when the test's last assertion passes.
 * Left alone, it fails afterwards, outside any test: "route.fetch: Test
 * ended". Playwright reports that error on its own, and the next test on the
 * same worker does not run — step zero of the reliability task saw
 * `jobs-cors.spec.ts:118` dropped that way after the credit test in
 * `instrument-updated.spec.ts` (2026-10-26).
 *
 * `unrouteAll({ behavior: "ignoreErrors" })` waits for the handlers still
 * running and ignores what they throw once the page is going away, which is
 * what Playwright's own message recommends. Every spec that routes requests
 * through to a server imports `test` from here instead of `@playwright/test`.
 */

import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  },
});
