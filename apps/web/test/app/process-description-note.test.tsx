/**
 * The 2026-10-30 review, finding 5: a service that does not declare
 * `ogc-process-description` may describe its processes another way
 * (`/per/core/alternative-process-description`), and the form says so.
 */

import {
  deriveCapabilities,
  parseConformance,
  unknownCapabilities,
  type ProcessList,
  type ServiceCapabilities,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessScreen } from "../../src/app/ProcessScreen.js";
import type { WorkflowCommands } from "../../src/app/useWorkflow.js";
import { workflowReducer, type Workflow, type WorkflowAction } from "../../src/app/workflow.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import conformance from "../../../../packages/core/test/fixtures/pygeoapi/conformance.json" with { type: "json" };
import { fixtureProcess } from "../forms/helpers.js";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

const NOTE = "The service does not say its descriptions follow the OGC process description";
const endpoint = { source: "typed", baseUrl: "http://localhost:5080" } as const;
const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };
const commands = new Proxy({} as WorkflowCommands, { get: () => vi.fn() });

function screenWith(capabilities: ServiceCapabilities): HTMLElement {
  const service: ServiceDescription = { url: "http://localhost:5080/", links: [], capabilities };
  const process = fixtureProcess("pygeoapi/breinstein-inputs");
  const plan = resolveFormPlan(process);
  const actions: WorkflowAction[] = [
    { type: "connect", endpoint },
    { type: "connected", connection: 1, endpoint, route: "direct", service, processes },
    { type: "open-process", processId: process.id },
    {
      type: "process-loaded",
      connection: 1,
      process,
      plan,
      values: initialValues(plan),
      warnings: [],
    },
  ];
  const state = actions.reduce<Workflow>(workflowReducer, { stage: "choose-endpoint" });
  if (state.stage !== "process") throw new Error(state.stage);
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <ProcessScreen
        state={state}
        commands={commands}
        fieldErrors={new Map()}
        jobs={[]}
        jobNotice={undefined}
        dismissAdvertisedBy="nothing"
      />,
    );
  });
  return host;
}

describe("the form on a service that does not declare ogc-process-description", () => {
  it("says its fields are a best reading", () => {
    expect(screenWith(unknownCapabilities()).textContent).toContain(NOTE);
  });

  it("says nothing on a service that declares it, as pygeoapi does", () => {
    const declared = deriveCapabilities(
      parseConformance(conformance, "http://localhost:5080/conformance"),
    );
    expect(declared.processDescription).toBe(true);
    expect(screenWith(declared).textContent).not.toContain(NOTE);
  });
});
