/**
 * Refuses to run the browser lane against a relay or a web build that was not
 * made from this checkout (review T4).
 *
 * Playwright starts both servers itself, but locally it reuses one already
 * listening on the lane's port — which is what a run left behind, or started
 * by hand, may be. Each server reports what it was built from (the relay on
 * `/healthz`, the web build in `e2e-build.txt`), and anything else stops the
 * run here, before a single test passes against the wrong code.
 */

import { relayBuild, webBuild } from "./fingerprint.js";
import { RELAY, WEB } from "./servers.js";

async function reported(url: string, read: (response: Response) => Promise<unknown>) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return response.ok ? await read(response) : undefined;
  } catch {
    return undefined;
  }
}

function refuse(what: string, url: string, found: unknown, expected: string): never {
  const port = new URL(url).port;
  throw new Error(
    [
      `The ${what} already listening on :${port} was not built from this checkout.`,
      `  It reports: ${typeof found === "string" ? found : "no build id"}`,
      `  This checkout is: ${expected}`,
      `The browser lane never reuses a ${what} from another build. Stop the process on :${port}`,
      `(\`lsof -nP -iTCP:${port} -sTCP:LISTEN\` finds it), then run the lane again.`,
    ].join("\n"),
  );
}

export default async function globalSetup(): Promise<void> {
  const relay = relayBuild();
  const relayFound = await reported(`${RELAY}/healthz`, async (response) => {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "build" in body ? body.build : undefined;
  });
  if (relayFound !== relay) refuse("relay", RELAY, relayFound, relay);

  const web = webBuild();
  const webFound = await reported(`${WEB}/e2e-build.txt`, async (response) =>
    (await response.text()).trim(),
  );
  if (webFound !== web) refuse("web build", WEB, webFound, web);
}
