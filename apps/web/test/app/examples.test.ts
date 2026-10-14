/**
 * Examples: what `config.json` may say about them, what the start screen and
 * the panel show, and the one action that connects to an example's service
 * and opens its process.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import {
  exampleNeeds,
  featuredExamples,
  filterExamples,
  groupByService,
  serviceLabel,
} from "../../src/app/examples.js";
import {
  INITIAL_WORKFLOW,
  workflowReducer,
  type EndpointRef,
  type Workflow,
  type WorkflowAction,
} from "../../src/app/workflow.js";
import { checkRuntimeConfig, type Example } from "../../src/config/runtime-config.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess } from "../forms/helpers.js";

const SERVICE = "https://ogc.example.org/api";
const OTHER = "https://processes.example.net";

function example(overrides: Partial<Example> = {}): Example {
  return {
    service: SERVICE,
    process: "breinstein-buildings",
    title: "Buildings in an area",
    summary: "Draw a shape; get the buildings inside it.",
    needs: "area",
    featured: false,
    ...overrides,
  };
}

describe("config.json examples", () => {
  it("reads examples, trimmed, with featured false and needs left out when not given", () => {
    const checked = checkRuntimeConfig({
      examples: [
        {
          service: `${SERVICE}/`,
          process: " breinstein-buildings ",
          title: " Buildings in an area ",
          summary: "Draw a shape; get the buildings inside it.",
          needs: "area",
          featured: true,
        },
        { service: OTHER, process: "hello-world", title: "Hello", summary: "Say hello." },
      ],
    });
    expect(checked).toEqual({
      ok: true,
      config: {
        relayUrl: undefined,
        presets: [],
        examples: [
          {
            service: SERVICE,
            process: "breinstein-buildings",
            title: "Buildings in an area",
            summary: "Draw a shape; get the buildings inside it.",
            needs: "area",
            featured: true,
          },
          {
            service: OTHER,
            process: "hello-world",
            title: "Hello",
            summary: "Say hello.",
            featured: false,
          },
        ],
      },
    });
  });

  it("leaves examples out of the config when the list is empty", () => {
    expect(checkRuntimeConfig({ examples: [] })).toEqual({
      ok: true,
      config: { relayUrl: undefined, presets: [] },
    });
  });

  const good = { service: SERVICE, process: "p", title: "T", summary: "S" };
  it.each([
    [{ examples: {} }, "examples must be a list"],
    [{ examples: ["x"] }, "examples[0] must be an object"],
    [{ examples: [{ ...good, colour: "red" }] }, 'examples[0] has an unknown member "colour"'],
    [{ examples: [{ ...good, service: 1 }] }, "examples[0].service must be a string"],
    [
      { examples: [{ ...good, service: "http://ogc.example.org" }] },
      "examples[0].service must be a plain https: URL",
    ],
    [
      { examples: [{ ...good, service: "https://u:p@ogc.example.org" }] },
      "examples[0].service must be a plain https: URL",
    ],
    [{ examples: [{ ...good, process: " " }] }, "examples[0].process must be a non-empty string"],
    [{ examples: [{ ...good, title: undefined }] }, "examples[0].title must be a non-empty string"],
    [{ examples: [{ ...good, summary: 3 }] }, "examples[0].summary must be a non-empty string"],
    [
      { examples: [{ ...good, needs: "map" }] },
      'examples[0].needs must be "area", "data" or "values"',
    ],
    [{ examples: [{ ...good, featured: "yes" }] }, "examples[0].featured must be true or false"],
    [
      { examples: [good, { ...good, needs: 1 }] },
      'examples[1].needs must be "area", "data" or "values"',
    ],
  ])("refuses the whole file for %j", (input, problem) => {
    expect(checkRuntimeConfig(input)).toEqual({ ok: false, problem });
  });

  it("does not refuse more than four featured: the first four in file order are shown", () => {
    const flagged = ["a", "b", "c", "d", "e", "f"].map((process) =>
      example({ process, featured: true }),
    );
    const checked = checkRuntimeConfig({
      examples: flagged.map(({ service, process, title, summary }) => ({
        service,
        process,
        title,
        summary,
        featured: true,
      })),
    });
    expect(checked.ok).toBe(true);
    expect(featuredExamples(flagged).map((each) => each.process)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("featured examples, search and filter", () => {
  const list = [
    example({ process: "buildings", featured: true }),
    example({ process: "hello", title: "Hello World", summary: "Say hello.", needs: "values" }),
    example({
      process: "area",
      title: "Area of each feature",
      summary: "Upload features.",
      needs: "data",
      featured: true,
    }),
    example({
      service: OTHER,
      process: "untagged",
      title: "No tag",
      summary: "Needs unknown.",
      needs: undefined,
    }),
  ];

  it("features only the flagged, in file order", () => {
    expect(featuredExamples(list).map((each) => each.process)).toEqual(["buildings", "area"]);
    expect(featuredExamples([])).toEqual([]);
  });

  it("searches title, summary and process id, ignoring case and spaces around", () => {
    expect(filterExamples(list, "  HELLO ", "all").map((each) => each.process)).toEqual(["hello"]);
    expect(filterExamples(list, "upload", "all").map((each) => each.process)).toEqual(["area"]);
    expect(filterExamples(list, "untag", "all").map((each) => each.process)).toEqual(["untagged"]);
    expect(filterExamples(list, "nothing like it", "all")).toEqual([]);
  });

  it("filters by what an example needs; one with no stated need is under All only", () => {
    expect(filterExamples(list, "", "area").map((each) => each.process)).toEqual(["buildings"]);
    expect(filterExamples(list, "", "values").map((each) => each.process)).toEqual(["hello"]);
    expect(filterExamples(list, "", "all")).toHaveLength(4);
    expect(filterExamples(list, "tag", "values")).toEqual([]);
  });

  it("groups by service, in the order services first appear", () => {
    const groups = groupByService(list);
    expect(groups.map((group) => [group.service, group.examples.length])).toEqual([
      [SERVICE, 3],
      [OTHER, 1],
    ]);
  });

  it("labels a service by host and path, and tells the list what processes need", () => {
    expect(serviceLabel(SERVICE)).toBe("ogc.example.org/api");
    expect(serviceLabel(OTHER)).toBe("processes.example.net");
    expect([...exampleNeeds(list, SERVICE)]).toEqual([
      ["buildings", "area"],
      ["hello", "values"],
      ["area", "data"],
    ]);
    expect(exampleNeeds(list, OTHER).size).toBe(0);
  });
});

describe("open-example: connect, then open the process", () => {
  const endpoint: EndpointRef = { source: "typed", baseUrl: "http://localhost:5080" };
  const service: ServiceDescription = {
    url: "http://localhost:5080/",
    links: [],
    capabilities: unknownCapabilities(),
  };
  const hello = fixtureProcess("pygeoapi/hello-world");
  const listed: ProcessList = { processes: [hello], links: [], pageCount: 1, truncated: false };
  const connected = (
    processes: ProcessList,
    route: "direct" | "relay" = "direct",
  ): WorkflowAction => ({
    type: "connected",
    connection: 1,
    endpoint,
    route,
    service,
    processes,
  });
  const reduce = (state: Workflow, ...actions: WorkflowAction[]) =>
    actions.reduce(workflowReducer, state);

  it("connects, then is opening the example's process, which the list will come back to", () => {
    const started = reduce(INITIAL_WORKFLOW, {
      type: "open-example",
      endpoint,
      processId: "hello-world",
    });
    expect(started).toEqual({
      stage: "choose-endpoint",
      connecting: endpoint,
      openAfter: "hello-world",
    });
    const landed = reduce(started, connected(listed));
    expect(landed.stage).toBe("connected");
    if (landed.stage !== "connected") return;
    expect(landed.opening).toBe("hello-world");
    expect(landed.lastOpened).toBe("hello-world");
    expect(landed.error).toBeUndefined();
  });

  it("lands on the list with a notice when the service has no such process", () => {
    const landed = reduce(
      INITIAL_WORKFLOW,
      { type: "open-example", endpoint, processId: "breinstein-gone" },
      connected(listed),
    );
    expect(landed.stage).toBe("connected");
    if (landed.stage !== "connected") return;
    expect(landed.opening).toBeUndefined();
    expect(landed.error).toEqual({
      title: "This service has no process called breinstein-gone.",
      detail: "The example names a process this service does not list. Choose one from the list.",
      notice: true,
    });
  });

  it("asks for it all the same when the list was cut short: it may be further on", () => {
    const landed = reduce(
      INITIAL_WORKFLOW,
      { type: "open-example", endpoint, processId: "breinstein-further" },
      connected({ ...listed, truncated: true }),
    );
    expect(landed.stage === "connected" && landed.opening).toBe("breinstein-further");
  });

  it("stays on the start screen with the error when connecting fails, and forgets the process", () => {
    const error = { title: "Could not connect to this server. Check the address and try again." };
    const failed = reduce(
      INITIAL_WORKFLOW,
      { type: "open-example", endpoint, processId: "hello-world" },
      { type: "connect-failed", endpoint, error },
    );
    expect(failed).toEqual({ stage: "choose-endpoint", error });
    // A plain connect afterwards opens nothing.
    const plain = reduce(failed, { type: "connect", endpoint }, connected(listed));
    expect(plain.stage === "connected" && plain.opening).toBeUndefined();
  });

  it("keeps the process through the relay question, and drops it when the answer is no", () => {
    const error = { title: "This page could not read this server." };
    const offered = reduce(
      INITIAL_WORKFLOW,
      { type: "open-example", endpoint, processId: "hello-world" },
      { type: "relay-offered", endpoint, error },
    );
    const confirmed = reduce(offered, { type: "relay-confirmed" });
    expect(confirmed).toMatchObject({ viaRelay: true, openAfter: "hello-world" });
    const viaRelay = reduce(confirmed, connected(listed, "relay"));
    expect(viaRelay.stage === "connected" && viaRelay.opening).toBe("hello-world");
    expect(reduce(offered, { type: "relay-declined" })).toEqual({
      stage: "choose-endpoint",
      error,
    });
  });

  it("is ignored mid-run and while the relay question is open", () => {
    const offered = reduce(
      INITIAL_WORKFLOW,
      { type: "connect", endpoint },
      {
        type: "relay-offered",
        endpoint,
        error: { title: "x" },
      },
    );
    expect(reduce(offered, { type: "open-example", endpoint, processId: "hello-world" })).toBe(
      offered,
    );

    const plan = resolveFormPlan(hello);
    const running = reduce(
      INITIAL_WORKFLOW,
      { type: "connect", endpoint },
      connected(listed),
      { type: "open-process", processId: "hello-world" },
      {
        type: "process-loaded",
        connection: 1,
        process: hello,
        plan,
        values: initialValues(plan),
        warnings: [],
      },
      { type: "run-started", runId: "r1", mode: "sync" },
    );
    expect(running.stage).toBe("running");
    expect(reduce(running, { type: "open-example", endpoint, processId: "slow" })).toBe(running);
  });

  it("starts afresh from a connection, for an example on another service", () => {
    const onList = reduce(INITIAL_WORKFLOW, { type: "connect", endpoint }, connected(listed));
    const other: EndpointRef = { source: "typed", baseUrl: "https://ogc.example.org/api" };
    expect(reduce(onList, { type: "open-example", endpoint: other, processId: "p" })).toEqual({
      stage: "choose-endpoint",
      connecting: other,
      openAfter: "p",
    });
  });
});
