/**
 * The input layer (package 3): every geometry the form holds is on the map
 * while it is being filled in, apart from the one being drawn, and it goes
 * when the process does.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { shownFor } from "../../src/app/MapPane.js";
import {
  INITIAL_WORKFLOW,
  workflowReducer,
  type EndpointRef,
  type Workflow,
  type WorkflowAction,
} from "../../src/app/workflow.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess } from "../forms/helpers.js";

const endpoint: EndpointRef = { source: "typed", baseUrl: "http://localhost:5080" };
const service: ServiceDescription = {
  url: "http://localhost:5080/",
  links: [],
  capabilities: unknownCapabilities(),
};
const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };

function loaded(key: string): WorkflowAction {
  const process = fixtureProcess(key);
  const plan = resolveFormPlan(process);
  return {
    type: "process-loaded",
    connection: 1,
    process,
    plan,
    values: initialValues(plan),
    warnings: [],
  };
}

function reduce(state: Workflow, ...actions: WorkflowAction[]): Workflow {
  return actions.reduce(workflowReducer, state);
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

const connected = reduce(
  INITIAL_WORKFLOW,
  { type: "connect", endpoint },
  { type: "connected", connection: 1, endpoint, route: "direct", service, processes },
);
const withArea = reduce(
  connected,
  { type: "open-process", processId: "breinstein-inputs" },
  loaded("pygeoapi/breinstein-inputs"),
  { type: "set-value", id: "area", value: { geojson: JSON.stringify(square) } },
);

function inputShapes(sets: ReturnType<typeof shownFor>) {
  return sets.find((set) => set.role === "input")?.shapes ?? [];
}

describe("the input layer", () => {
  it("shows a loaded geometry while the form is being filled in", () => {
    expect(withArea.stage).toBe("process");
    expect(inputShapes(shownFor(withArea))).toEqual([square]);
  });

  it("leaves out the field the map is drawing for, which the draw mode shows itself", () => {
    expect(inputShapes(shownFor(withArea, "area"))).toEqual([]);
    expect(inputShapes(shownFor(withArea, "some-other-field"))).toEqual([square]);
  });

  it("shows nothing for GeoJSON that does not parse yet", () => {
    const typing = reduce(withArea, {
      type: "set-value",
      id: "area",
      value: { geojson: '{"type": "Poly' },
    });
    expect(inputShapes(shownFor(typing))).toEqual([]);
  });

  it("empties when another process is opened, and when the form is left", () => {
    const other = reduce(
      withArea,
      { type: "open-process", processId: "breinstein-bbox" },
      loaded("pygeoapi/breinstein-bbox"),
    );
    expect(other.stage).toBe("process");
    expect(inputShapes(shownFor(other))).toEqual([]);
    expect(shownFor(reduce(withArea, { type: "back-to-list" }))).toEqual([]);
  });

  it("keeps showing what was sent while the run is under way", () => {
    const running = reduce(withArea, { type: "run-started", runId: "run-1", mode: "sync" });
    // Drawing has ended with the form: a stale field id changes nothing.
    expect(inputShapes(shownFor(running, "area"))).toEqual([square]);
  });
});
