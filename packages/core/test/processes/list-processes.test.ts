/**
 * `listProcesses()`, and the `rel="next"` walk in particular.
 *
 * The walk is the part with no natural stopping condition, so every way it can
 * fail to stop is pinned here: a server that points `next` at itself, one that
 * paginates forever, and a caller that changes their mind mid-walk. An
 * unguarded version of any of the three hangs a browser tab.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw.setup.js";
import zooPage1 from "../fixtures/zoo-project/process-list-limit20.json" with { type: "json" };
import zooPage2 from "../fixtures/zoo-project/process-list-limit20-skip20.json" with { type: "json" };
import pygeoapiList from "../fixtures/pygeoapi/process-list.json" with { type: "json" };
import { AbortError } from "../../src/http/errors.js";
import { MalformedProcessDocumentError } from "../../src/errors.js";
import { listProcesses } from "../../src/processes/list-processes.js";
import type { Observation } from "../../src/observations.js";

const BASE = "https://service.test/oapi/";
const LIST = `${BASE}processes`;

type Document = Record<string, unknown>;

function collect(): { sink: (observation: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (observation) => seen.push(observation), seen };
}

/** A page carrying `ids`, linking on to `next` when one is given. */
function page(ids: readonly string[], next?: string): Document {
  return {
    processes: ids.map((id) => ({
      id,
      version: "1.0.0",
      jobControlOptions: ["sync-execute"],
      links: [{ rel: "self", type: "application/json", href: `${LIST}/${id}` }],
    })),
    links: [
      { rel: "self", type: "application/json", href: LIST },
      ...(next === undefined ? [] : [{ rel: "next", type: "application/json", href: next }]),
    ],
  };
}

describe("listProcesses on a single page", () => {
  it("returns pygeoapi's real list, untruncated", async () => {
    server.use(http.get(LIST, () => HttpResponse.json(pygeoapiList)));

    const list = await listProcesses(LIST);

    expect(list.processes.map((process) => process.id)).toEqual(["hello-world"]);
    expect(list.pageCount).toBe(1);
    expect(list.truncated).toBe(false);
    expect(list).not.toHaveProperty("truncationReason");
    // pygeoapi 0.21.0 declares no numberTotal.
    expect(list).not.toHaveProperty("numberTotal");
  });

  it("carries ZOO's numberTotal so a UI can say '20 of 703'", async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ ...zooPage1, links: [] })));

    const list = await listProcesses(LIST);

    expect(list.processes).toHaveLength(20);
    expect(list.numberTotal).toBe(703);
  });
});

describe("the next walk", () => {
  it("joins two pages into one list", async () => {
    // One handler, branching on the query: MSW matches by path, so a second
    // handler registered at `${LIST}?skip=2` would never be reached.
    server.use(
      http.get(LIST, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("skip") === "2"
            ? page(["c"])
            : page(["a", "b"], `${LIST}?skip=2`),
        ),
      ),
    );

    const list = await listProcesses(LIST);

    expect(list.processes.map((process) => process.id)).toEqual(["a", "b", "c"]);
    expect(list.pageCount).toBe(2);
    expect(list.truncated).toBe(false);
  });

  it("stops when a page points `next` back at one already visited", async () => {
    // A real bug in the wild, and the one that costs a browser tab.
    server.use(
      http.get(LIST, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has("skip")
            ? page(["c"], LIST)
            : page(["a"], `${LIST}?skip=1`),
        ),
      ),
    );

    const list = await listProcesses(LIST);

    expect(list.processes.map((process) => process.id)).toEqual(["a", "c"]);
    expect(list.truncated).toBe(true);
    expect(list.truncationReason).toBe("cycle");
  });

  it("stops at the page cap on a server that paginates forever", async () => {
    let served = 0;
    server.use(
      http.get(LIST, ({ request }) => {
        served += 1;
        const skip = Number(new URL(request.url).searchParams.get("skip") ?? "0");
        return HttpResponse.json(page([`p${String(skip)}`], `${LIST}?skip=${String(skip + 1)}`));
      }),
    );

    const list = await listProcesses(LIST);

    expect(list.pageCount).toBe(20);
    expect(served).toBe(20);
    expect(list.truncated).toBe(true);
    expect(list.truncationReason).toBe("page-cap");
    expect(list.processes).toHaveLength(20);
  });

  it("honours a lower maxPages, and 21 pages of content stop at the cap", async () => {
    server.use(
      http.get(LIST, ({ request }) => {
        const skip = Number(new URL(request.url).searchParams.get("skip") ?? "0");
        return HttpResponse.json(
          skip >= 20
            ? page([`p${String(skip)}`])
            : page([`p${String(skip)}`], `${LIST}?skip=${String(skip + 1)}`),
        );
      }),
    );

    const capped = await listProcesses(LIST, { maxPages: 3 });
    expect(capped.pageCount).toBe(3);
    expect(capped.truncationReason).toBe("page-cap");

    const full = await listProcesses(LIST, { maxPages: 21 });
    expect(full.pageCount).toBe(21);
    expect(full.truncated).toBe(false);
  });

  it("keeps the first occurrence of an id repeated across pages", async () => {
    server.use(
      http.get(LIST, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("skip") === "2"
            ? page(["b", "c"])
            : page(["a", "b"], `${LIST}?skip=2`),
        ),
      ),
    );

    const { sink, seen } = collect();
    const list = await listProcesses(LIST, { onObservation: sink });

    expect(list.processes.map((process) => process.id)).toEqual(["a", "b", "c"]);
    const observation = seen.find((entry) => entry.kind === "process-list-fetched");
    expect(observation).toMatchObject({ duplicateCount: 1, processCount: 3, pageCount: 2 });
  });

  it("aborts between pages without making the second request", async () => {
    const controller = new AbortController();
    let served = 0;
    server.use(
      http.get(LIST, ({ request }) => {
        served += 1;
        if (new URL(request.url).searchParams.has("skip")) return HttpResponse.json(page(["b"]));
        controller.abort();
        return HttpResponse.json(page(["a"], `${LIST}?skip=1`));
      }),
    );

    await expect(listProcesses(LIST, { signal: controller.signal })).rejects.toBeInstanceOf(
      AbortError,
    );
    expect(served).toBe(1);
  });

  it("walks ZOO's real two captured pages", async () => {
    // The hrefs in the fixtures are ZOO's own, so the handlers match those.
    const zooList = "http://localhost:5090/ogc-api/processes";
    server.use(
      http.get(zooList, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("skip") === "20" ? zooPage2 : zooPage1,
        ),
      ),
    );

    const list = await listProcesses(`${zooList}?limit=20`, { maxPages: 2 });

    expect(list.pageCount).toBe(2);
    expect(list.processes).toHaveLength(40);
    expect(list.processes[0]?.id).toBe("hellojs");
    expect(list.processes[20]?.id).toBe("SAGA.contrib_perego.5");
    // The second page still advertises a next, so the cap is what stopped us.
    expect(list.truncationReason).toBe("page-cap");
  });
});

describe("listProcesses shape handling", () => {
  it("applies the limit hint to the first request only", async () => {
    const asked: string[] = [];
    server.use(
      http.get(LIST, ({ request }) => {
        asked.push(request.url);
        return HttpResponse.json(asked.length === 1 ? page(["a"], `${LIST}?skip=1`) : page(["b"]));
      }),
    );

    await listProcesses(LIST, { limit: 20 });

    expect(asked[0]).toContain("limit=20");
    // The second page is whatever the server built, untouched.
    expect(asked[1]).toBe(`${LIST}?skip=1`);
  });

  it("throws when `processes` is not an array, naming the page", async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ processes: "lots", links: [] })));

    await expect(listProcesses(LIST)).rejects.toThrow(MalformedProcessDocumentError);
    await expect(listProcesses(LIST)).rejects.toThrow(
      /page 1.*`processes` is string, not an array/s,
    );
  });

  it("throws when a page is a bare array", async () => {
    server.use(http.get(LIST, () => HttpResponse.json([{ id: "a" }])));

    await expect(listProcesses(LIST)).rejects.toThrow(/expected a JSON object, got an array/);
  });

  it("names the offending entry's index and page for a bad id", async () => {
    server.use(
      http.get(LIST, () => HttpResponse.json({ processes: [{ id: "a" }, { id: 7 }], links: [] })),
    );

    await expect(listProcesses(LIST)).rejects.toThrow(/page 1, entry at index 1.*`id` is number/s);
  });

  it("records warnings and unrecognised keys on the observation, not on the result", async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          processes: [{ id: "a", keywords: "solo", vendorThing: 1 }],
          links: [],
        }),
      ),
    );

    const { sink, seen } = collect();
    const list = await listProcesses(LIST, { onObservation: sink });

    expect(list.processes[0]).not.toHaveProperty("vendorThing");
    const observation = seen.find((entry) => entry.kind === "process-list-fetched");
    expect(observation).toMatchObject({ unrecognisedKeys: ["vendorThing"] });
    expect(observation?.kind === "process-list-fetched" && observation.warnings).toEqual(
      expect.arrayContaining(["keywords-is-a-string-not-an-array", "version-absent"]),
    );
  });

  it("redacts the query out of the observed URL", async () => {
    server.use(http.get(LIST, () => HttpResponse.json(page(["a"]))));

    const { sink, seen } = collect();
    await listProcesses(`${LIST}?token=secret`, { onObservation: sink });

    const observation = seen.find((entry) => entry.kind === "process-list-fetched");
    expect(observation?.url).toBe("https://service.test/oapi/processes");
  });
});
