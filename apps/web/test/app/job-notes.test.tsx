/**
 * What a background job's line says beyond its status: that no progress has
 * been reported for a while, and that the server changed its answer after a
 * first `successful` (finding 0047).
 */

import {
  unknownCapabilities,
  type JobStatus,
  type ProcessList,
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
import type { JobRow } from "../../src/relay/job-session.js";
import { fixtureProcess } from "../forms/helpers.js";
import { status } from "../relay/harness.js";

let root: Root | undefined;
let host: HTMLElement | undefined;

function render(node: React.ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(node);
  });
  return host;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

const JOB = "http://localhost:5080/jobs/1";
const endpoint = { source: "typed", baseUrl: "http://localhost:5080" } as const;
const service: ServiceDescription = {
  url: "http://localhost:5080/",
  links: [],
  capabilities: unknownCapabilities(),
};
const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };

function stateAfter(...more: WorkflowAction[]): Workflow {
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
    { type: "run-started", runId: "run-1", mode: "async" },
    { type: "job-started", runId: "run-1", jobRef: JOB },
    ...more,
  ];
  return actions.reduce<Workflow>(workflowReducer, { stage: "choose-endpoint" });
}

function row(change: Partial<JobRow>): JobRow {
  return {
    statusUrl: JOB,
    ref: "ref-1",
    status: status("accepted", JOB),
    polls: 1,
    doorbells: 0,
    lastError: undefined,
    settled: false,
    gone: false,
    acceptedSince: 0,
    acceptedLong: false,
    confirmation: undefined,
    endpointKey: "pygeoapi-cors",
    endpoint: "http://localhost:5080",
    route: "relay",
    processId: "breinstein-inputs",
    startedAt: "2026-09-30T10:00:00.000Z",
    restored: false,
    ...change,
  };
}

const commands = new Proxy({} as WorkflowCommands, { get: () => vi.fn() });

function screen(state: Workflow, job: JobRow): HTMLElement {
  if (state.stage !== "running" && state.stage !== "result") throw new Error(state.stage);
  return render(
    <ProcessScreen
      state={state}
      commands={commands}
      fieldErrors={new Map()}
      jobs={[job]}
      jobNotice={undefined}
      dismissAdvertisedBy="nothing"
    />,
  );
}

describe("a job that stays accepted", () => {
  it("says nothing before the threshold", () => {
    const view = screen(stateAfter(), row({}));
    expect(view.querySelector("[data-accepted-long]")).toBeNull();
  });

  it("says, as information, that no progress has been reported yet", () => {
    const view = screen(stateAfter(), row({ acceptedLong: true }));
    const note = view.querySelector("[data-accepted-long]");
    expect(note?.textContent).toContain(
      "No progress reported yet. Some servers report accepted until the job finishes.",
    );
    // Not a warning and not an alert: nothing is known to be wrong.
    expect(note?.closest(".notice, .error-box, [role='alert']")).toBeNull();
  });

  it("marks whether the job has callbacks, and how many doorbells rang", () => {
    const running = view(stateAfter(), row({ doorbells: 2 }));
    expect(running?.getAttribute("data-callbacks")).toBe("registered");
    expect(running?.getAttribute("data-doorbells")).toBe("2");
  });
});

function view(state: Workflow, job: JobRow) {
  return screen(state, job).querySelector("[data-job-ref]");
}

describe("a status the server changed after a first successful (finding 0047)", () => {
  const withResults = stateAfter({
    type: "results",
    runId: "run-1",
    results: [{ kind: "json", outputId: "echo", value: { ok: true } }],
  });
  const failed: JobStatus = { ...status("failed", JOB), message: "callback could not be sent" };

  it("shows both statuses above the results, and keeps the results", () => {
    const page = screen(
      withResults,
      row({
        status: failed,
        settled: true,
        confirmation: { state: "changed", first: status("successful", JOB) },
      }),
    );
    const note = page.querySelector("[data-status-changed]");
    expect(note?.getAttribute("data-status-changed")).toBe("successful->failed");
    expect(note?.textContent).toContain(
      "The server first reported this job successful, and later failed — callback could not be sent.",
    );
    expect(page.querySelector('[data-output-id="echo"]')).not.toBeNull();
  });

  it("keeps the job's callback and doorbell markers on the result", () => {
    const page = screen(
      withResults,
      row({ status: status("successful", JOB), settled: true, doorbells: 1 }),
    );
    const result = page.querySelector("[data-result-of]");
    expect(result?.getAttribute("data-result-of")).toBe(JOB);
    expect(result?.getAttribute("data-callbacks")).toBe("registered");
    expect(result?.getAttribute("data-doorbells")).toBe("1");
    expect(result?.querySelector('[data-output-id="echo"]')).not.toBeNull();
  });

  it("says nothing when the second read agreed", () => {
    const page = screen(
      withResults,
      row({ status: status("successful", JOB), confirmation: { state: "unchanged" } }),
    );
    expect(page.querySelector("[data-status-changed]")).toBeNull();
  });

  it("says the result is not yet confirmed while the page reads on (review W14)", () => {
    const page = screen(
      withResults,
      row({ status: status("successful", JOB), confirmation: { state: "pending" } }),
    );
    const note = page.querySelector("[data-result-of] [data-not-yet-confirmed]");
    expect(note?.textContent).toContain("Not yet confirmed by the server.");
    expect(note?.textContent).toContain("for up to 3 minutes");
    // Information, not a warning: nothing is known to be wrong.
    expect(note?.closest(".notice, .error-box, [role='alert']")).toBeNull();
    expect(page.querySelector('[data-output-id="echo"]')).not.toBeNull();
  });

  it("says nothing more once the success callback was delivered", () => {
    const page = screen(
      withResults,
      row({
        status: status("successful", JOB),
        settled: true,
        confirmation: { state: "delivered" },
      }),
    );
    expect(page.querySelector("[data-not-yet-confirmed]")).toBeNull();
    expect(page.querySelector("[data-status-changed]")).toBeNull();
  });
});
