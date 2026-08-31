/**
 * Where the ZOO-Project reference deployment lives, and whether it is usable.
 *
 * Shared by the interop files rather than duplicated, because the probe is the
 * part that must not drift: a lane that never blocks has to skip cleanly, and
 * skipping cleanly depends on asking the right question.
 */

import { send } from "../../src/http/transport.js";

/** Started by `./infra/zoo/zoo.sh up`. See infra/zoo/README.md. */
export const ZOO: string = "http://localhost:5090/ogc-api";

/**
 * The landing page, *with* its trailing slash. Not cosmetic: without it ZOO
 * answers 400 and an XML exception report rather than redirecting. Finding 0010.
 */
export const LANDING: string = `${ZOO}/`;

/**
 * A *usable* landing page, not merely a reachable socket.
 *
 * A half-started ZOO answers 503 from Apache while the worker behind it comes
 * up, and a stack resumed with `docker start` instead of `./infra/zoo/zoo.sh up`
 * stays that way. Both are completed HTTP responses, so a probe that only asked
 * "did anything come back" would turn a whole file red instead of skipping it.
 */
export async function answering(): Promise<boolean> {
  try {
    const response = await send(LANDING, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    return response.status === 200 && response.isJson;
  } catch {
    return false;
  }
}
