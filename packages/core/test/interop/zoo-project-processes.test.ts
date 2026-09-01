/**
 * ZOO-Project: the process list and the process description.
 *
 * The half of Task 3's contract that pygeoapi cannot exercise. ZOO is the only
 * one of the two servers that actually paginates, the only one with a live
 * `maxOccurs: "unbounded"`, and the only one with a real spatial input — so
 * every one of those guarantees is pinned against a real server here rather
 * than against a mock.
 *
 * Reports, never blocks. Start the stack with `./infra/zoo/zoo.sh up`.
 */

import { describe, expect, it } from "vitest";
import listFixture from "../fixtures/zoo-project/process-list-limit20.json" with { type: "json" };
import page2Fixture from "../fixtures/zoo-project/process-list-limit20-skip20.json" with { type: "json" };
import echoFixture from "../fixtures/zoo-project/processes/echo.json" with { type: "json" };
import gdalFixture from "../fixtures/zoo-project/processes/Gdal_Translate.json" with { type: "json" };
import { createClient } from "../../src/index.js";
import { ProcessNotFoundError } from "../../src/errors.js";
import { ProcessesError } from "../../src/http/errors.js";
import { findLink } from "../../src/links/find.js";
import { send } from "../../src/http/transport.js";
import { LANDING, ZOO, answering } from "./zoo.js";
import type { Observation } from "../../src/observations.js";

const zooUp = await answering();

function client() {
  return createClient({ baseUrl: LANDING });
}

async function live(url: string): Promise<unknown> {
  return (await send(url, { headers: { Accept: "application/json" } })).json();
}

describe.skipIf(!zooUp)("ZOO-Project process list", () => {
  it("lists all 703 processes in one page when no limit is asked for", async () => {
    const list = await client().listProcesses();

    expect(list.processes.length).toBe(703);
    expect(list.numberTotal).toBe(703);
    expect(list.pageCount).toBe(1);
    expect(list.truncated).toBe(false);
    expect(list.processes.map((process) => process.id)).toContain("echo");
  });

  it("follows rel=next when a limit makes the server paginate", async () => {
    // ZOO pages with `skip`, not the `offset` OGC API - Common uses — finding
    // 0019. The walk does not care, because it follows the href the server
    // built rather than constructing one.
    const list = await client().listProcesses({ limit: 20, maxPages: 3 });

    expect(list.pageCount).toBe(3);
    expect(list.processes).toHaveLength(60);
    expect(list.truncated).toBe(true);
    expect(list.truncationReason).toBe("page-cap");
  });

  it("walks to the end of the catalogue and stops without truncating", async () => {
    const list = await client().listProcesses({ limit: 100, maxPages: 20 });

    expect(list.processes).toHaveLength(703);
    expect(list.pageCount).toBe(8);
    expect(list.truncated).toBe(false);
    // The last page correctly omits `next`, which is what let the walk finish.
    expect(findLink(list.links, "next")).toBeUndefined();
  });

  it("still matches the captured page fixtures", async () => {
    await expect(live(`${ZOO}/processes?limit=20`)).resolves.toEqual(listFixture);
    await expect(live(`${ZOO}/processes?limit=20&skip=20`)).resolves.toEqual(page2Fixture);
  });

  it("advertises a self link on every list entry, unlike its descriptions", async () => {
    // Finding 0017 is about the *description* document. The list entries do
    // carry `self`, on all 703 — so link-first is the live route here too, and
    // the constructed path is a real fallback rather than the main road.
    const list = await client().listProcesses();

    const withoutSelf = list.processes.filter(
      (process) => findLink(process.links, "self") === undefined,
    );
    expect(withoutSelf).toEqual([]);
    expect(findLink(list.processes[0]?.links ?? [], "self")?.href).toBe(
      `${ZOO}/processes/${String(list.processes[0]?.id)}`,
    );
  });

  it("declares all three job control options on every process", async () => {
    const list = await client().listProcesses();

    for (const process of list.processes) {
      expect(process.execution).toMatchObject({
        sync: true,
        async: true,
        dismiss: true,
        defaulted: false,
      });
    }
  });

  it("reports mutable and metadata as unmodelled members", async () => {
    const observations: Observation[] = [];
    await client().listProcesses({ limit: 20, onObservation: (entry) => observations.push(entry) });

    const observation = observations.find((entry) => entry.kind === "process-list-fetched");
    expect(observation?.kind === "process-list-fetched" && observation.unrecognisedKeys).toEqual(
      expect.arrayContaining(["mutable", "metadata"]),
    );
  });
});

describe.skipIf(!zooUp)("ZOO-Project process description", () => {
  it("parses echo, matching the captured fixture", async () => {
    await expect(live(`${ZOO}/processes/echo`)).resolves.toEqual(echoFixture);

    const process = await client().getProcess("echo");

    expect(process.inputs.map((input) => input.id)).toEqual(["a", "b", "c", "pause"]);
    expect(process.outputs.map((output) => output.id)).toEqual(["a", "b", "c"]);
  });

  it("hands back the bounding-box schema deep-equal to the wire", async () => {
    const process = await client().getProcess("echo");
    const bbox = process.inputs.find((input) => input.id === "c");

    expect(bbox?.schema).toEqual(echoFixture.inputs.c.schema);
    expect(bbox?.schema["format"]).toBe("ogc-bbox");
  });

  it("reads Gdal_Translate's live maxOccurs 'unbounded'", async () => {
    const process = await client().getProcess("Gdal_Translate");
    const gcp = process.inputs.find((input) => input.id === "GCP");

    expect(gcp?.maxOccurs).toBe("unbounded");
    expect(gcp?.multiple).toBe(true);
    expect(gcp?.required).toBe(false);
    await expect(live(`${ZOO}/processes/Gdal_Translate`)).resolves.toEqual(gdalFixture);
  });

  it("takes the constructed path, because the description carries no self link", async () => {
    // Finding 0017: the fetched description advertises `execute` and
    // `alternate`, never `self`. A caller who did not come via the list has
    // nothing to follow, which is exactly what the fallback is for.
    const observations: Observation[] = [];
    const process = await client().getProcess("echo", {
      onObservation: (entry) => observations.push(entry),
    });

    expect(observations.find((entry) => entry.kind === "process-fetched")).toMatchObject({
      route: "constructed-path",
    });
    expect(findLink(process.links, "self")).toBeUndefined();
  });

  it("takes the link-first route when handed the list entry", async () => {
    const service = client();
    const list = await service.listProcesses();
    const summary = list.processes.find((process) => process.id === "echo");
    if (summary === undefined) throw new Error("echo is not in this server's catalogue");

    const observations: Observation[] = [];
    const process = await service.getProcess("echo", {
      summary,
      onObservation: (entry) => observations.push(entry),
    });

    expect(process.id).toBe("echo");
    expect(observations.find((entry) => entry.kind === "process-fetched")).toMatchObject({
      route: "advertised-link",
    });
  });

  it("raises ProcessNotFoundError for an unknown process id", async () => {
    // Finding 0014 is about an unknown *path* answering 400. `/processes/{id}`
    // is a path ZOO routes, and it correctly answers 404 with the OGC
    // no-such-process exception URI — so the error type is the same as
    // pygeoapi's, and the finding does not extend here.
    const error = await client()
      .getProcess("no-such-process-here")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessNotFoundError);
  });

  it("reports rather than hides the two processes whose descriptions 500", async () => {
    // Finding 0020: OTB.ReadImageInfo and OTB.ConvertSensorToGeoPoint appear in
    // /processes but their descriptions are an Apache HTML 500. Pinned so the
    // count is visible if it changes; not worked around.
    for (const id of ["OTB.ReadImageInfo", "OTB.ConvertSensorToGeoPoint"]) {
      const error = await client()
        .getProcess(id)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ProcessesError);
      expect((error as ProcessesError).status).toBe(500);
      expect(error).not.toBeInstanceOf(ProcessNotFoundError);
    }
  });

  it("censuses the schema shapes the form generator will meet", async () => {
    const observations: Observation[] = [];
    await client().getProcess("echo", { onObservation: (entry) => observations.push(entry) });

    const observation = observations.find((entry) => entry.kind === "process-fetched");
    expect(observation?.kind === "process-fetched" && observation.schemaShapes).toEqual({
      total: 4,
      inlineType: 3,
      enumerated: 0,
      // No $ref inside a `schema` anywhere on this server: ZOO puts its refs in
      // the vendor `extended-schema` sibling instead.
      ref: 0,
      composed: 1,
      contentMediaType: 0,
      formatted: 2,
      absent: 0,
    });
  });
});
