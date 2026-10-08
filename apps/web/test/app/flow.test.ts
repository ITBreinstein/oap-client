/**
 * The flow from one process to another: when the map is on screen (only while
 * it has a job to do — an input it can draw, or a result it can show), and
 * what the process list remembers of a connection when the user comes back.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { mapNeeded } from "../../src/app/map-need.js";
import {
  INITIAL_WORKFLOW,
  workflowReducer,
  type EndpointRef,
  type Workflow,
  type WorkflowAction,
} from "../../src/app/workflow.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import type { RenderableResult } from "../../src/results/renderable.js";
import { fixtureProcess } from "../forms/helpers.js";

const endpoint: EndpointRef = { source: "typed", baseUrl: "http://localhost:5080" };
const service: ServiceDescription = {
  url: "http://localhost:5080/",
  links: [],
  capabilities: unknownCapabilities(),
};
const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };
const NO_LIMIT = Number.POSITIVE_INFINITY;

function reduce(state: Workflow, ...actions: WorkflowAction[]): Workflow {
  return actions.reduce(workflowReducer, state);
}

const connected = reduce(
  INITIAL_WORKFLOW,
  { type: "connect", endpoint },
  { type: "connected", connection: 1, endpoint, route: "direct", service, processes },
);

/** The process `id` from the pygeoapi fixtures, open with its form. */
function opened(id: string): Workflow {
  const process = fixtureProcess(`pygeoapi/${id}`);
  const plan = resolveFormPlan(process);
  return reduce(
    connected,
    { type: "open-process", processId: id },
    {
      type: "process-loaded",
      connection: 1,
      process,
      plan,
      values: initialValues(plan),
      warnings: [],
    },
  );
}

/** `state` after a synchronous run that returned `results`. */
function finished(state: Workflow, results: readonly RenderableResult[]): Workflow {
  return reduce(
    state,
    { type: "run-started", runId: "r1", mode: "sync" },
    { type: "results", runId: "r1", results },
  );
}

const square = {
  type: "Polygon",
  coordinates: [
    [
      [5.1, 52.1],
      [5.2, 52.1],
      [5.2, 52.2],
      [5.1, 52.1],
    ],
  ],
};

describe("when the map is on screen", () => {
  it("is off before a process is open", () => {
    expect(mapNeeded(INITIAL_WORKFLOW, NO_LIMIT)).toBe(false);
    expect(mapNeeded(connected, NO_LIMIT)).toBe(false);
  });

  it("is off for a process with nothing to draw, before and after its run", () => {
    const hello = opened("hello-world");
    expect(hello.stage).toBe("process");
    expect(mapNeeded(hello, NO_LIMIT)).toBe(false);
    const done = finished(hello, [
      { kind: "json", outputId: "echo", value: { id: "echo", value: "Hello!" } },
    ]);
    expect(done.stage).toBe("result");
    expect(mapNeeded(done, NO_LIMIT)).toBe(false);
  });

  it.each(["breinstein-bbox", "breinstein-rotate", "breinstein-feature-area"])(
    "is on while %s's form is open, for an input the map can draw",
    (id) => {
      expect(mapNeeded(opened(id), NO_LIMIT)).toBe(true);
    },
  );

  it("comes on with a result that can be drawn, though no input could be", () => {
    const done = finished(opened("hello-world"), [
      { kind: "json", outputId: "echo", value: square },
    ]);
    expect(mapNeeded(done, NO_LIMIT)).toBe(true);
  });

  it("stays off for a result with more coordinates than the page draws", () => {
    const done = finished(opened("hello-world"), [
      { kind: "json", outputId: "echo", value: square },
    ]);
    expect(mapNeeded(done, 3)).toBe(false);
  });

  it("stays off for an image with no box to place it", () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const done = finished(opened("breinstein-png"), [
      {
        kind: "download",
        outputId: "image",
        blob,
        mediaType: "image/png",
        filename: "image.png",
        reason: "not-text",
      },
    ]);
    expect(mapNeeded(done, NO_LIMIT)).toBe(false);
  });
});

describe("coming back to the process list", () => {
  it("remembers the process opened last, and which processes ran", () => {
    const done = finished(opened("hello-world"), [
      { kind: "json", outputId: "echo", value: { id: "echo", value: "Hello!" } },
    ]);
    const back = reduce(done, { type: "back-to-list" });
    expect(back.stage).toBe("connected");
    if (back.stage !== "connected") return;
    expect(back.lastOpened).toBe("hello-world");
    expect(back.ran).toEqual(["hello-world"]);
  });

  it("counts a process once however often it runs, and keeps the others", () => {
    const hello = [{ kind: "json" as const, outputId: "echo", value: "Hello!" }];
    const twice = reduce(finished(opened("hello-world"), hello), { type: "edit" });
    const again = finished(twice, hello);
    const other = reduce(again, { type: "open-process", processId: "breinstein-png" });
    expect(other.stage === "connected" && other.ran).toEqual(["hello-world"]);
    expect(other.stage === "connected" && other.lastOpened).toBe("breinstein-png");
  });

  it("does not mark a process that was opened but not run", () => {
    const back = reduce(opened("breinstein-bbox"), { type: "back-to-list" });
    expect(back.stage === "connected" && back.lastOpened).toBe("breinstein-bbox");
    expect(back.stage === "connected" && (back.ran ?? [])).toEqual([]);
  });

  it("forgets both on a new connection", () => {
    const done = finished(opened("hello-world"), [{ kind: "json", outputId: "echo", value: 1 }]);
    const fresh = reduce(
      done,
      { type: "disconnect" },
      { type: "connect", endpoint },
      { type: "connected", connection: 2, endpoint, route: "direct", service, processes },
    );
    expect(fresh.stage === "connected" && fresh.lastOpened).toBeUndefined();
    expect(fresh.stage === "connected" && fresh.ran).toBeUndefined();
  });
});
