// @vitest-environment node
/**
 * Review 2026-09-30 (read-only audit), finding 0039: when the relay names a
 * job, what does the core's `execution` record say about the browser?
 *
 * The session's `run` composes exactly this: a core client whose `fetch` is
 * `createRoutedFetch`, reporting into one observation sink. The relay hands
 * back `Location` and `Preference-Applied`, which the browser could not read
 * from pygeoapi itself; the routed fetch rebuilds a `Response` carrying both.
 */

import { execute, type FetchLike, type Observation } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import type { RelayedExecute, RelayEndpoint } from "../../src/relay/contract.js";
import type { RelayClient } from "../../src/relay/relay-client.js";
import { createRoutedFetch } from "../../src/relay/routed-fetch.js";

const BASE = "http://localhost:5080";
const ENDPOINT: RelayEndpoint = {
  key: "pygeoapi-cors",
  baseUrl: BASE,
  executeRoute: "relay",
  readRoute: "direct",
  callbacks: false,
};

const CREATED: RelayedExecute = {
  upstream: {
    status: 201,
    location: `${BASE}/jobs/42`,
    contentType: "application/json",
    preferenceApplied: "respond-async",
    body: "null",
  },
  ref: undefined,
};

function relay(): RelayClient {
  return {
    baseUrl: "http://localhost:8787",
    endpoints: () => Promise.resolve([]),
    createSession: () => Promise.resolve({ token: "s", expiresAt: 0 }),
    openEvents: () => Promise.reject(new Error("not used")),
    forward: () => Promise.reject(new Error("not used")),
    execute: () => Promise.resolve(CREATED),
  };
}

async function executionRecordVia(fetch: FetchLike) {
  const seen: Observation[] = [];
  await execute(`${BASE}/processes`, "slow", {
    inputs: { seconds: 1 },
    mode: "async",
    fetch,
    onObservation: (observation) => seen.push(observation),
  }).catch(() => undefined);
  const record = seen.find((observation) => observation.kind === "execution");
  if (record === undefined) throw new Error("no execution record");
  return record as unknown as Record<string, unknown>;
}

describe("the execution record of a relay-named job (finding 0039)", () => {
  it.fails(
    "W13: is told apart from a server that exposes Location and Preference-Applied itself",
    async () => {
      const viaRelay = await executionRecordVia(
        createRoutedFetch({ endpoint: ENDPOINT, relay: relay() }),
      );

      // A server that really exposes both headers to the page, answered direct.
      const exposed = await executionRecordVia(() =>
        Promise.resolve(
          new Response("null", {
            status: 201,
            headers: {
              "Content-Type": "application/json",
              Location: `${BASE}/jobs/42`,
              "Preference-Applied": "respond-async",
            },
          }),
        ),
      );

      // pygeoapi from a browser, direct: neither header readable (finding 0039).
      const hidden = await executionRecordVia(() =>
        Promise.resolve(
          new Response("null", { status: 201, headers: { "Content-Type": "application/json" } }),
        ),
      );

      expect(hidden).toMatchObject({ locationPresent: false, preferenceAppliedHeader: false });

      // Today the relay-named record is field for field what a server exposing
      // both headers would produce (locationPresent, preferenceAppliedHeader,
      // discoveredVia "location-header"). Nothing in it says the relay read them.
      const strip = (record: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(record).filter(([key]) => key !== "elapsedMs"));
      expect(strip(viaRelay)).not.toEqual(strip(exposed));
    },
  );
});
