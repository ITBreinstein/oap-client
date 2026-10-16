import { afterEach } from "vitest";

// React 19 requires this flag before `act` will flush updates outside a bundler.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The page writes where it is into its address and history (app/address.ts),
// and a test file shares one window: each test starts on a clean address, as
// a fresh page would, rather than reconnecting where the last one left off.
// Files that run in plain Node have no history to clean.
afterEach(() => {
  if ("history" in globalThis) globalThis.history.replaceState(null, "", "/");
});
