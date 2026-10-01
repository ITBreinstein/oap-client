/**
 * Late answers: a request's answer that arrives after the user has moved on
 * is dropped, even when the screen it arrives on looks the same (review W4,
 * W5). Every answer carries what it was for — the connection it was fetched
 * on, the run it belongs to — and the reducer compares.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import {
  INITIAL_WORKFLOW,
  workflowReducer,
  type EndpointRef,
  type Workflow,
  type WorkflowAction,
} from "../../src/app/workflow.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import type { LoadedReference } from "../../src/results/reference.js";
import type { RenderableResult } from "../../src/results/renderable.js";
import { fixtureProcess } from "../forms/helpers.js";

const A: EndpointRef = { source: "typed", baseUrl: "http://localhost:5080" };
const B: EndpointRef = { source: "typed", baseUrl: "http://localhost:5081" };
const service: ServiceDescription = {
  url: "http://localhost:5080/",
  links: [],
  capabilities: unknownCapabilities(),
};
const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };
const process = fixtureProcess("pygeoapi/breinstein-inputs");
const plan = resolveFormPlan(process);

function reduce(state: Workflow, ...actions: WorkflowAction[]): Workflow {
  return actions.reduce(workflowReducer, state);
}

function connect(endpoint: EndpointRef, connection: number): WorkflowAction[] {
  return [
    { type: "connect", endpoint },
    { type: "connected", endpoint, connection, route: "direct", service, processes },
  ];
}

function described(connection: number, title: string): WorkflowAction {
  return {
    type: "process-loaded",
    connection,
    process: { ...process, title },
    plan,
    values: initialValues(plan),
    warnings: [],
  };
}

describe("a description from an earlier connection (W4)", () => {
  it("is dropped after the user moved to another server and opened the same process", () => {
    const onB = reduce(
      INITIAL_WORKFLOW,
      ...connect(A, 1),
      { type: "open-process", processId: process.id },
      // "Change service" while A's description is still being read.
      { type: "disconnect" },
      ...connect(B, 2),
      { type: "open-process", processId: process.id },
    );
    expect(reduce(onB, described(1, "as server A describes it"))).toBe(onB);

    const opened = reduce(onB, described(2, "as server B describes it"));
    expect(opened.stage === "process" ? opened.process.title : undefined).toBe(
      "as server B describes it",
    );
  });

  it("is dropped after reconnecting to the same server", () => {
    const again = reduce(
      INITIAL_WORKFLOW,
      ...connect(A, 1),
      { type: "open-process", processId: process.id },
      { type: "disconnect" },
      ...connect(A, 2),
      { type: "open-process", processId: process.id },
    );
    expect(reduce(again, described(1, "from the first connection"))).toBe(again);
  });

  it("drops a failure from an earlier connection too", () => {
    const onB = reduce(
      INITIAL_WORKFLOW,
      ...connect(A, 1),
      { type: "open-process", processId: process.id },
      { type: "disconnect" },
      ...connect(B, 2),
      { type: "open-process", processId: process.id },
    );
    const late: WorkflowAction = {
      type: "process-failed",
      connection: 1,
      processId: process.id,
      error: { title: "server A timed out" },
    };
    expect(reduce(onB, late)).toBe(onB);
  });
});

function loadedFrom(href: string): LoadedReference {
  return {
    outcome: "ok",
    route: "direct",
    representation: "geojson",
    mediaType: "application/geo+json",
    status: undefined,
    detail: `read from ${href}`,
    blob: undefined,
    geojson: { type: "Point", coordinates: [5, 52] },
    contentCrs: undefined,
    axes: "as-is",
    page: undefined,
    itemsUrl: undefined,
  };
}

const reference = (href: string): RenderableResult => ({
  kind: "reference",
  outputId: "Result",
  href,
});

const form = reduce(
  INITIAL_WORKFLOW,
  ...connect(A, 1),
  { type: "open-process", processId: process.id },
  described(1, "Every input kind"),
);

describe("an answer for an earlier run (W5)", () => {
  const run2 = reduce(
    form,
    { type: "run-started", runId: "run-1", mode: "sync" },
    { type: "results", runId: "run-1", results: [reference("https://files.example/run-1.json")] },
    // "Change the inputs" while run 1's Load is still reading, then Run.
    { type: "edit" },
    { type: "run-started", runId: "run-2", mode: "sync" },
    { type: "results", runId: "run-2", results: [reference("https://files.example/run-2.json")] },
  );

  it("does not put run 1's loaded reference on run 2's output of the same name", () => {
    const late: WorkflowAction = {
      type: "reference-loaded",
      runId: "run-1",
      outputId: "Result",
      loaded: loadedFrom("https://files.example/run-1.json"),
    };
    expect(reduce(run2, late)).toBe(run2);

    const own = reduce(run2, {
      type: "reference-loaded",
      runId: "run-2",
      outputId: "Result",
      loaded: loadedFrom("https://files.example/run-2.json"),
    });
    expect(own).not.toBe(run2);
  });

  it("does not end run 2 with run 1's cancellation, results or job", () => {
    const running = reduce(
      form,
      { type: "run-started", runId: "run-1", mode: "async" },
      { type: "job-started", runId: "run-1", jobRef: "http://localhost:5080/jobs/1" },
      { type: "run-failed", runId: "run-1", error: { title: "failed" } },
      { type: "run-started", runId: "run-2", mode: "async" },
    );
    expect(running.stage).toBe("running");
    const late: WorkflowAction[] = [
      { type: "run-failed", runId: "run-1", error: { title: "Job cancelled.", notice: true } },
      { type: "results", runId: "run-1", results: [] },
      { type: "job-started", runId: "run-1", jobRef: "http://localhost:5080/jobs/1" },
    ];
    for (const action of late) expect(reduce(running, action)).toBe(running);
  });
});
