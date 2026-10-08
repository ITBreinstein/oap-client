/**
 * Escape declines the relay offer from the moment the question is on screen
 * (review W22, and the read-route e2e that still lost an Escape now and then).
 *
 * The offer appears after a failed fetch, not a user event, so React commits it
 * and runs its passive effects later, after the browser may already have
 * painted. A listener attached in a passive effect leaves a gap in which the
 * question is visible and Escape does nothing. This test presses Escape in that
 * gap: from a MutationObserver, which runs as a microtask right after the
 * commit, before React's scheduler gets to the passive effects.
 *
 * Outside `act`, deliberately: `act` flushes every effect before it returns,
 * which closes exactly the gap this test is about.
 */

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RelayOffer } from "../../src/app/RelayRoute.js";

/** The flag `test/setup.ts` sets, cast the same way. */
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean };

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = false;
});

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  // Let any effect React still had scheduled run against the unmounted root.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

it("declines on an Escape pressed as soon as the question is in the page", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const mounted = host;
  let declined = 0;

  const pressed = new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (mounted.querySelector("[data-testid='relay-offer']") === null) return;
      observer.disconnect();
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      resolve();
    });
    observer.observe(mounted, { childList: true, subtree: true });
  });

  root = createRoot(mounted);
  root.render(
    <RelayOffer
      onConfirm={() => undefined}
      onDecline={() => {
        declined += 1;
      }}
    />,
  );
  await pressed;

  expect(declined).toBe(1);
});
