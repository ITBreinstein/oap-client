/**
 * The workflow reducer: every legal transition, and the illegal ones it must
 * refuse by handing back the very same state.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ProcessSummary,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import {
  listedProcesses,
  outputSelection,
  runError,
  runRequest,
  typedEndpoint,
} from "../../src/app/run.js";
import {
  INITIAL_WORKFLOW,
  workflowReducer,
  type EndpointRef,
  type Workflow,
  type WorkflowAction,
} from "../../src/app/workflow.js";
import { fixtureProcess } from "../forms/helpers.js";

const endpoint: EndpointRef = { source: "typed", baseUrl: "http://localhost:5080" };
const service: ServiceDescription = {
  url: "http://localhost:5080/",
  links: [],
  capabilities: unknownCapabilities(),
};
const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };

const inputsProcess = fixtureProcess("pygeoapi/breinstein-inputs");
const bboxProcess = fixtureProcess("pygeoapi/breinstein-bbox");

function loaded(process = inputsProcess): WorkflowAction {
  const plan = resolveFormPlan(process);
  return { type: "process-loaded", process, plan, values: initialValues(plan), warnings: [] };
}

function reduce(state: Workflow, ...actions: WorkflowAction[]): Workflow {
  return actions.reduce(workflowReducer, state);
}

const connected = reduce(
  INITIAL_WORKFLOW,
  { type: "connect", endpoint },
  { type: "connected", endpoint, route: "direct", service, processes },
);
const open = reduce(connected, { type: "open-process", processId: "breinstein-inputs" }, loaded());
const running = reduce(open, { type: "run-started", mode: "sync" });
const result = reduce(running, {
  type: "results",
  results: [{ kind: "json", outputId: "echo", value: {} }],
});

describe("workflowReducer: the legal path", () => {
  it("connects", () => {
    const connecting = reduce(INITIAL_WORKFLOW, { type: "connect", endpoint });
    expect(connecting).toEqual({ stage: "choose-endpoint", connecting: endpoint });
    expect(connected).toMatchObject({ stage: "connected", endpoint, processes });
  });

  it("reports a failed connection on the endpoint screen", () => {
    const failed = reduce(
      INITIAL_WORKFLOW,
      { type: "connect", endpoint },
      { type: "connect-failed", endpoint, error: { title: "blocked" } },
    );
    expect(failed).toEqual({ stage: "choose-endpoint", error: { title: "blocked" } });
  });

  it("opens a process with a fresh plan, its starting values, and the default mode", () => {
    expect(open).toMatchObject({ stage: "process", process: { id: "breinstein-inputs" } });
    if (open.stage !== "process") throw new Error("not open");
    expect(open.values["ratio"]).toBe("0.5");
    expect(open.mode).toBe("sync");
  });

  it("keeps a failed description on the list screen", () => {
    const failed = reduce(
      connected,
      { type: "open-process", processId: "x" },
      { type: "process-failed", processId: "x", error: { title: "no" } },
    );
    expect(failed).toMatchObject({ stage: "connected", error: { title: "no" } });
  });

  it("sets a value and a mode on the form", () => {
    const changed = reduce(
      open,
      { type: "set-value", id: "label", value: "hello" },
      { type: "set-mode", mode: "async" },
    );
    if (changed.stage !== "process") throw new Error("not open");
    expect(changed.values["label"]).toBe("hello");
    expect(changed.mode).toBe("async");
  });

  it("runs synchronously to a result, and back to the form with the values kept", () => {
    expect(running).toMatchObject({ stage: "running", run: { mode: "sync" } });
    expect(result).toMatchObject({ stage: "result", results: [{ outputId: "echo" }] });
    const edited = reduce(result, { type: "edit" });
    expect(edited.stage).toBe("process");
    if (edited.stage !== "process" || open.stage !== "process") throw new Error("not open");
    expect(edited.values).toEqual(open.values);
  });

  it("runs asynchronously, holding the job's reference and never its status", () => {
    const started = reduce(
      open,
      { type: "run-started", mode: "async" },
      { type: "job-started", jobRef: "http://localhost:5080/jobs/1" },
    );
    expect(started).toEqual({
      ...started,
      run: { mode: "async", jobRef: "http://localhost:5080/jobs/1" },
    });
    expect(JSON.stringify(started)).not.toContain('"status"');
    const done = reduce(started, { type: "results", results: [] });
    expect(done).toMatchObject({ stage: "result", jobRef: "http://localhost:5080/jobs/1" });
  });

  it("follows a server that answers a synchronous request with a job", () => {
    const became = reduce(running, { type: "job-started", jobRef: "j" });
    expect(became).toMatchObject({ stage: "running", run: { mode: "async", jobRef: "j" } });
  });

  it("returns a failed run to the form, with the reason", () => {
    const failed = reduce(running, { type: "run-failed", error: { title: "400" } });
    expect(failed).toMatchObject({ stage: "process", error: { title: "400" } });
  });

  it("goes back to the list, and disconnects", () => {
    expect(reduce(open, { type: "back-to-list" }).stage).toBe("connected");
    expect(reduce(result, { type: "back-to-list" }).stage).toBe("connected");
    expect(reduce(result, { type: "disconnect" })).toEqual(INITIAL_WORKFLOW);
  });
});

describe("workflowReducer: the relay offer", () => {
  const zoo: EndpointRef = {
    source: "configured",
    key: "zoo",
    baseUrl: "http://localhost:5090/ogc-api",
    executeRoute: "relay",
    readRoute: "relay",
    callbacks: false,
  };
  const blocked = { title: "This server doesn't allow access from a web page." };
  const connecting = reduce(INITIAL_WORKFLOW, { type: "connect", endpoint: zoo });
  const offered = reduce(connecting, { type: "relay-offered", endpoint: zoo, error: blocked });

  it("holds the question open until it is answered", () => {
    expect(offered).toEqual({ stage: "choose-endpoint", offer: { endpoint: zoo, error: blocked } });
    // Nothing else moves it: not a new connection, not a stray answer.
    expect(workflowReducer(offered, { type: "connect", endpoint })).toBe(offered);
    expect(
      workflowReducer(offered, {
        type: "connected",
        endpoint: zoo,
        route: "direct",
        service,
        processes,
      }),
    ).toBe(offered);
    expect(
      workflowReducer(offered, {
        type: "connected",
        endpoint: zoo,
        route: "relay",
        service,
        processes,
      }),
    ).toBe(offered);
  });

  it("tries the relay only after the user confirmed, and shows it", () => {
    const confirmed = reduce(offered, { type: "relay-confirmed" });
    expect(confirmed).toEqual({ stage: "choose-endpoint", connecting: zoo, viaRelay: true });
    const through = reduce(confirmed, {
      type: "connected",
      endpoint: zoo,
      route: "relay",
      service,
      processes,
    });
    expect(through).toMatchObject({ stage: "connected", route: "relay" });
  });

  it("shows the direct failure when the user declines", () => {
    expect(reduce(offered, { type: "relay-declined" })).toEqual({
      stage: "choose-endpoint",
      error: blocked,
    });
  });

  it("reports a relay attempt that failed, and never connects it as direct", () => {
    const confirmed = reduce(offered, { type: "relay-confirmed" });
    expect(
      workflowReducer(confirmed, {
        type: "connected",
        endpoint: zoo,
        route: "direct",
        service,
        processes,
      }),
    ).toBe(confirmed);
    expect(
      reduce(confirmed, { type: "connect-failed", endpoint: zoo, error: { title: "relay down" } }),
    ).toEqual({ stage: "choose-endpoint", error: { title: "relay down" } });
  });

  it("has no way to the relay route without an offer and a confirmation", () => {
    // A direct attempt cannot be answered as a relay one...
    expect(
      workflowReducer(connecting, {
        type: "connected",
        endpoint: zoo,
        route: "relay",
        service,
        processes,
      }),
    ).toBe(connecting);
    // ...and a confirmation with no question open does nothing.
    expect(workflowReducer(connecting, { type: "relay-confirmed" })).toBe(connecting);
    expect(workflowReducer(INITIAL_WORKFLOW, { type: "relay-confirmed" })).toBe(INITIAL_WORKFLOW);
    // An offer after the relay was already chosen is refused too.
    const confirmed = reduce(offered, { type: "relay-confirmed" });
    expect(
      workflowReducer(confirmed, { type: "relay-offered", endpoint: zoo, error: blocked }),
    ).toBe(confirmed);
  });

  it("keeps the route on every stage after connecting", () => {
    const through = reduce(
      offered,
      { type: "relay-confirmed" },
      {
        type: "connected",
        endpoint: zoo,
        route: "relay",
        service,
        processes,
      },
    );
    const opened = reduce(
      through,
      { type: "open-process", processId: "breinstein-inputs" },
      loaded(),
    );
    expect(opened).toMatchObject({ stage: "process", route: "relay" });
    expect(reduce(opened, { type: "back-to-list" })).toMatchObject({ route: "relay" });
  });
});

describe("workflowReducer: what it refuses", () => {
  it.each<[string, Workflow, WorkflowAction]>([
    ["a result without a run", result, { type: "results", results: [] }],
    ["a job without a run", result, { type: "job-started", jobRef: "j" }],
    [
      "a second job for one run",
      reduce(running, { type: "job-started", jobRef: "a" }),
      { type: "job-started", jobRef: "b" },
    ],
    ["a run from a result, without editing first", result, { type: "run-started", mode: "sync" }],
    ["a run while one is running", running, { type: "run-started", mode: "sync" }],
    ["leaving a process mid-run", running, { type: "open-process", processId: "x" }],
    ["a value typed into a running form", running, { type: "set-value", id: "label", value: "x" }],
    ["a description nobody asked for", connected, loaded()],
    [
      "a stale connection",
      reduce(INITIAL_WORKFLOW, { type: "connect", endpoint }),
      {
        type: "connected",
        endpoint: { source: "typed", baseUrl: "http://elsewhere" },
        route: "direct",
        service,
        processes,
      },
    ],
    ["connecting while connected", connected, { type: "connect", endpoint }],
    [
      "a failure for a run that is not running",
      open,
      { type: "run-failed", error: { title: "x" } },
    ],
  ])("%s", (_name, state, action) => {
    expect(workflowReducer(state, action)).toBe(state);
  });

  it("clears the plan and the values when the process changes (reduction test c)", () => {
    const edited = reduce(open, {
      type: "set-value",
      id: "label",
      value: "typed before switching",
    });
    const switched = reduce(
      edited,
      { type: "open-process", processId: "breinstein-bbox" },
      loaded(bboxProcess),
    );
    if (switched.stage !== "process") throw new Error("not open");
    expect(switched.plan.fields.map((field) => field.id)).toEqual(["bbox"]);
    expect(switched.values).toEqual({ bbox: undefined });
  });
});

describe("the run request", () => {
  it("R8: names every declared output, so ZOO does not refuse the body (finding 0025)", () => {
    const echo = fixtureProcess("zoo-project/echo");
    const plan = resolveFormPlan(echo);
    expect(runRequest(echo, plan, { a: "x" })).toEqual({
      inputs: { a: "x" },
      outputs: { a: {}, b: {}, c: {} },
      notes: [],
    });
    expect(outputSelection(inputsProcess)).toEqual({ echo: {}, summary: {} });
  });

  it("carries the encoder's notes, for the observation", () => {
    const echo = fixtureProcess("zoo-project/echo");
    const request = runRequest(echo, resolveFormPlan(echo), {
      c: { coordinates: [3, 50.7, 7, 53.6], crs: "urn:ogc:def:crs:EPSG:6.6:4326" },
    });
    expect(request.notes).toEqual([
      { inputId: "c", code: "bbox-axis-swapped", crs: "urn:ogc:def:crs:EPSG:6.6:4326" },
    ]);
  });
});

describe("typedEndpoint", () => {
  it("tidies an address and refuses what is not one", () => {
    expect(typedEndpoint("  http://localhost:5080/ ")).toEqual({
      source: "typed",
      baseUrl: "http://localhost:5080",
    });
    expect(typedEndpoint("localhost:5080")).toBeUndefined();
    expect(typedEndpoint("ftp://example.org")).toBeUndefined();
  });
});

describe("runError", () => {
  it("says what happened, and points at an input the server named", () => {
    const plan = resolveFormPlan(inputsProcess);
    const error = runError(new Error("socket closed"), plan);
    expect(error).toEqual({ title: "The request did not complete.", detail: "socket closed" });
  });
});

describe("listedProcesses", () => {
  const summary = (id: string): ProcessSummary => ({ ...inputsProcess, id });
  const list: ProcessList = {
    processes: [summary("Buffer"), summary("SAGA.x"), summary("hellojs"), summary("OTB.y")],
    links: [],
    pageCount: 1,
    truncated: false,
  };
  const zoo: EndpointRef = {
    source: "configured",
    key: "zoo",
    baseUrl: "http://localhost:5090/ogc-api",
    executeRoute: "relay",
    readRoute: "relay",
    callbacks: false,
    processes: ["hellojs", "Buffer", "NotThere"],
  };

  it("keeps the configured ids, in the server's order, and says what it left out", () => {
    const { processes, listFilter } = listedProcesses(zoo, list);
    expect(processes.processes.map((entry) => entry.id)).toEqual(["Buffer", "hellojs"]);
    expect(listFilter).toEqual({ read: 4, missing: ["NotThere"], applied: true });
  });

  it("keeps the narrowed list's truncation, so the screen can hedge what is missing", () => {
    const { processes } = listedProcesses(zoo, { ...list, truncated: true });
    expect(processes.truncated).toBe(true);
  });

  it("shows everything when none of the configured ids was read, and says so", () => {
    const renamed: EndpointRef = { ...zoo, processes: ["EchoProcess", "NotThere"] };
    expect(listedProcesses(renamed, list)).toEqual({
      processes: list,
      listFilter: { read: 4, missing: ["EchoProcess", "NotThere"], applied: false },
    });
  });

  it("shows everything for an endpoint that names no processes, and for a typed one", () => {
    const all: EndpointRef = { ...zoo, processes: undefined };
    expect(listedProcesses(all, list)).toEqual({ processes: list, listFilter: undefined });
    expect(listedProcesses(endpoint, list)).toEqual({ processes: list, listFilter: undefined });
  });
});
