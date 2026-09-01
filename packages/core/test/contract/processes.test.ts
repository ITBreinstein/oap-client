/**
 * Contract tests for the process layer against pygeoapi 0.21.0, pinned in
 * infra/compose/pygeoapi.yml.
 *
 * Every expectation here was derived from what the running server actually
 * sends. Where a captured fixture exists, the live response is compared against
 * it, so an upstream change shows up as a test failure rather than as drift
 * nobody notices until a plugfest.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "../../src/index.js";
import { ProcessNotFoundError } from "../../src/errors.js";
import { send } from "../../src/http/transport.js";
import listFixture from "../fixtures/pygeoapi/process-list.json" with { type: "json" };
import helloWorldFixture from "../fixtures/pygeoapi/processes/hello-world.json" with { type: "json" };
import type { Observation } from "../../src/observations.js";

const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";

let client: Client;
let seen: Observation[];

beforeAll(async () => {
  seen = [];
  client = createClient({ baseUrl: CORS, onObservation: (entry) => seen.push(entry) });
  try {
    await send(CORS, { signal: AbortSignal.timeout(5000) });
  } catch (cause) {
    throw new Error(
      `pygeoapi is not answering on ${CORS}. Start it with:\n` +
        `  docker compose -f infra/compose/pygeoapi.yml up -d --wait`,
      { cause },
    );
  }
});

describe("listProcesses against pygeoapi", () => {
  it("finds hello-world from a fresh client, without inspect() being called first", async () => {
    const list = await client.listProcesses();

    expect(list.processes.map((process) => process.id)).toContain("hello-world");
    expect(list.pageCount).toBe(1);
    expect(list.truncated).toBe(false);
  });

  it("still matches the captured fixture, so an upstream change is a test failure", async () => {
    const live = await (
      await send(`${CORS}/processes`, { headers: { Accept: "application/json" } })
    ).json();

    expect(live).toEqual(listFixture);
  });

  it("reads jobControlOptions from the server rather than defaulting", async () => {
    const list = await client.listProcesses();
    const hello = list.processes.find((process) => process.id === "hello-world");

    expect(hello?.execution).toEqual({
      sync: true,
      async: true,
      // pygeoapi does not declare dismiss on the process, which is finding 0006
      // seen from the process rather than from the conformance document.
      dismiss: false,
      declared: ["sync-execute", "async-execute"],
      defaulted: false,
    });
  });

  it("advertises a self link on the list entry, so link-first is the live route", async () => {
    const list = await client.listProcesses();
    const hello = list.processes.find((process) => process.id === "hello-world");
    const self = hello?.links.find((link) => link.rel === "self");

    expect(self?.href).toBe(`${CORS}/processes/hello-world?f=json`);
  });

  it("ignores limit and offset — pygeoapi 0.21.0 does not paginate /processes", async () => {
    // Recorded rather than worked around: finding 0018.
    const paged = await client.listProcesses({ limit: 1 });
    const offset = await (
      await send(`${CORS}/processes?offset=99`, { headers: { Accept: "application/json" } })
    ).json();

    expect(paged.pageCount).toBe(1);
    expect(paged.truncated).toBe(false);
    expect(paged.links.some((link) => link.rel === "next")).toBe(false);
    expect(offset).toEqual(listFixture);
  });
});

describe("getProcess against pygeoapi", () => {
  it("takes the link-first route when handed the list entry", async () => {
    const list = await client.listProcesses();
    const summary = list.processes.find((process) => process.id === "hello-world");
    if (summary === undefined) throw new Error("hello-world is not on this server");

    const observations: Observation[] = [];
    const process = await client.getProcess("hello-world", {
      summary,
      onObservation: (entry) => observations.push(entry),
    });

    expect(process.id).toBe("hello-world");
    expect(observations.find((entry) => entry.kind === "process-fetched")).toMatchObject({
      route: "advertised-link",
    });
  });

  it("takes the constructed-path route when it has no list entry", async () => {
    const observations: Observation[] = [];
    const process = await client.getProcess("hello-world", {
      onObservation: (entry) => observations.push(entry),
    });

    expect(observations.find((entry) => entry.kind === "process-fetched")).toMatchObject({
      route: "constructed-path",
    });
    expect(process.inputs.map((input) => input.id)).toEqual(["name", "message"]);
  });

  it("returns inputs and outputs matching the pinned fixture", async () => {
    const process = await client.getProcess("hello-world");

    expect(process.inputs).toEqual([
      {
        id: "name",
        title: "Name",
        description: helloWorldFixture.inputs.name.description,
        keywords: ["full name", "personal"],
        minOccurs: 1,
        maxOccurs: 1,
        required: true,
        multiple: false,
        schema: { type: "string" },
      },
      {
        id: "message",
        title: "Message",
        description: "An optional message to echo as well",
        keywords: ["message"],
        minOccurs: 0,
        maxOccurs: 1,
        required: false,
        multiple: false,
        schema: { type: "string" },
      },
    ]);
    expect(process.outputs).toEqual([
      {
        id: "echo",
        title: "Hello, world",
        description: helloWorldFixture.outputs.echo.description,
        schema: { type: "object", contentMediaType: "application/json" },
      },
    ]);
  });

  it("hands back the schema deep-equal to what the server sent", async () => {
    const live = await (
      await send(`${CORS}/processes/hello-world`, { headers: { Accept: "application/json" } })
    ).json();
    const process = await client.getProcess("hello-world");

    expect(live).toEqual(helloWorldFixture);
    expect(process.inputs[0]?.schema).toEqual(helloWorldFixture.inputs.name.schema);
  });

  it("raises ProcessNotFoundError for an id this server does not have", async () => {
    // pygeoapi answers 404 with a NoSuchProcess exception body.
    const error = await client
      .getProcess("no-such-process-here")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessNotFoundError);
    expect((error as ProcessNotFoundError).processId).toBe("no-such-process-here");
  });

  it("behaves identically through the CORS-disabled instance, from Node", async () => {
    const plain = createClient({ baseUrl: NOCORS });
    const process = await plain.getProcess("hello-world");

    expect(process.inputs.map((input) => input.id)).toEqual(["name", "message"]);
  });
});
