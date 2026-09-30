/**
 * "My jobs" on screen: what each row says, and the two actions kept apart —
 * Remove from list at once, Dismiss only where allowed and only once
 * confirmed.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsPanel } from "../../src/jobs/JobsPanel.js";
import type { DismissAdvertisedBy, JobRow } from "../../src/relay/job-session.js";
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

function row(change: Partial<JobRow> = {}): JobRow {
  return {
    statusUrl: JOB,
    ref: undefined,
    status: status("running", JOB),
    polls: 1,
    doorbells: 0,
    lastError: undefined,
    settled: false,
    gone: false,
    acceptedSince: undefined,
    acceptedLong: false,
    confirmation: undefined,
    endpointKey: "typed",
    endpoint: "http://localhost:5080",
    route: "direct",
    processId: "slow",
    startedAt: "2026-09-30T10:00:00.000Z",
    restored: false,
    ...change,
  };
}

function panel(
  jobs: JobRow[],
  options: { advertised?: DismissAdvertisedBy; active?: string } = {},
) {
  const onRemove = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <JobsPanel
      jobs={jobs}
      activeJob={options.active}
      dismissAdvertisedFor={() => options.advertised ?? "nothing"}
      messages={new Map()}
      onRemove={onRemove}
      onDismiss={onDismiss}
    />,
  );
  return { view, onRemove, onDismiss };
}

function button(view: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...view.querySelectorAll("button")].find((entry) => entry.textContent === name);
}

describe("My jobs", () => {
  it("is not shown without jobs", () => {
    const { view } = panel([]);
    expect(view.querySelector('[data-testid="my-jobs"]')).toBeNull();
  });

  it("shows the process, the endpoint, the start time, the status and its progress", () => {
    const { view } = panel([row({ status: { ...status("running", JOB), progress: 40 } })]);
    const item = view.querySelector(`[data-job-row="${JOB}"]`);
    expect(item?.textContent).toContain("slow");
    expect(item?.textContent).toContain("on localhost:5080");
    expect(item?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-09-30T10:00:00.000Z");
    expect(item?.textContent).toContain("running, 40%");
  });

  it("links to the results of a successful job", () => {
    const { view } = panel([row({ status: status("successful", JOB) })]);
    expect(view.querySelector("a")?.getAttribute("href")).toBe(`${JOB}/results`);
  });

  it("offers no results link for a job that has not succeeded", () => {
    const { view } = panel([row()]);
    expect(view.querySelector("a")).toBeNull();
  });

  it("removes a job from the list at once, without asking", () => {
    const { view, onRemove, onDismiss } = panel([row()]);
    act(() => {
      button(view, "Remove from list")?.click();
    });
    expect(onRemove).toHaveBeenCalledWith(JOB);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not remove the job the run on screen is waiting for", () => {
    const { view } = panel([row()], { active: JOB });
    expect(button(view, "Remove from list")?.disabled).toBe(true);
  });

  it("offers no Dismiss where dismissal is neither advertised nor seen to work", () => {
    const { view } = panel([row()], { advertised: "nothing" });
    expect(button(view, "Dismiss…")).toBeUndefined();
  });

  it("dismisses only after confirmation, and Keep job cancels the question", () => {
    const { view, onDismiss } = panel([row()], { advertised: "observed-earlier" });
    act(() => {
      button(view, "Dismiss…")?.click();
    });
    expect(view.textContent).toContain("Dismiss this job on the server?");
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      button(view, "Keep job")?.click();
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      button(view, "Dismiss…")?.click();
    });
    act(() => {
      button(view, "Dismiss job")?.click();
    });
    expect(onDismiss).toHaveBeenCalledWith(JOB);
  });

  it("says a restored job is polled, and a job the server no longer has is gone", () => {
    const { view } = panel([
      row({ restored: true }),
      row({ statusUrl: `${JOB}0`, gone: true, settled: true, status: undefined }),
    ]);
    expect(view.textContent).toContain("From an earlier visit: its status is polled");
    expect(view.textContent).toContain("No longer on the server: dismissed, or expired.");
  });
});
