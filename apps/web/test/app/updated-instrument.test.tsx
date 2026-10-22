/**
 * STYLE TRIAL: what the updated Instrument does that Instrument doesn't,
 * where it is behaviour rather than a look: JSON laid out with tabs when a
 * field is left, a job's facts one to a line, Run again, and Copy's names.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldView } from "../../src/app/FormFields.js";
import { ResultsView } from "../../src/app/ResultsView.js";
import { UpdatedContext } from "../../src/app/variant.js";
import { JobsPanel } from "../../src/jobs/JobsPanel.js";
import type { JobRow } from "../../src/relay/job-session.js";
import type { RenderableResult } from "../../src/results/renderable.js";
import { planFor } from "../forms/helpers.js";
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

describe("a JSON field", () => {
  // A `oneOf` of plain types is not the complex-input pattern: a raw JSON editor.
  const plan = planFor({
    settings: { schema: { oneOf: [{ type: "string" }, { type: "number" }] } },
  });
  const [field] = plan.fields;

  function leave(updated: boolean, rawJson: string) {
    if (field === undefined) throw new Error("no field");
    const onChange = vi.fn();
    const view = render(
      <UpdatedContext value={updated}>
        <FieldView
          field={field}
          index={0}
          values={{ settings: { rawJson } }}
          error={undefined}
          onChange={onChange}
        />
      </UpdatedContext>,
    );
    act(() => {
      view.querySelector("textarea")?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    return onChange;
  }

  it("is laid out with tabs when left, in the updated Instrument, every value as typed", () => {
    const onChange = leave(true, '{"a":1.0,"b":[1,2]}');
    expect(onChange).toHaveBeenCalledWith("settings", {
      rawJson: '{\n\t"a": 1.0,\n\t"b": [\n\t\t1,\n\t\t2\n\t]\n}',
    });
  });

  it("is left as typed in Instrument as it is, and when it isn't JSON", () => {
    expect(leave(false, '{"a":1}')).not.toHaveBeenCalled();
    expect(leave(true, '{"a":')).not.toHaveBeenCalled();
  });
});

describe("a job in My jobs, in the updated Instrument", () => {
  const JOB = "http://localhost:5080/jobs/1";
  const job: JobRow = {
    statusUrl: JOB,
    ref: undefined,
    status: { ...status("successful", JOB), progress: 100, message: "Job complete" },
    polls: 1,
    doorbells: 0,
    lastError: undefined,
    settled: true,
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
    followed: false,
    cancelledAt: undefined,
  };

  it("has its title and status as a badge, then one labelled line per fact", () => {
    const view = render(
      <JobsPanel
        jobs={[job]}
        activeJob={undefined}
        dismissAdvertisedFor={() => "nothing"}
        messages={new Map()}
        onRemove={vi.fn()}
        onDismiss={vi.fn()}
        structured
      />,
    );
    expect(view.querySelector(".job-title")?.textContent).toBe("slow");
    const badge = view.querySelector(".job-badge");
    expect(badge?.getAttribute("data-job-state")).toBe("successful");
    expect(badge?.getAttribute("role")).toBe("status");
    const facts = [...view.querySelectorAll(".job-facts > div")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(facts.map(([label]) => label)).toEqual(["Service", "Started", "Progress", "Message"]);
    expect(facts[0]?.[1]).toBe("localhost:5080");
    expect(facts[2]?.[1]).toBe("100%");
    expect(facts[3]?.[1]).toBe("Job complete");
  });
});

describe("Run again in My jobs, in the updated Instrument", () => {
  const JOB = "http://localhost:5080/jobs/2";
  const job: JobRow = {
    statusUrl: JOB,
    ref: undefined,
    status: status("successful", JOB),
    polls: 1,
    doorbells: 0,
    lastError: undefined,
    settled: true,
    gone: false,
    acceptedSince: undefined,
    acceptedLong: false,
    confirmation: undefined,
    endpointKey: "typed",
    endpoint: "http://localhost:5080",
    route: "direct",
    processId: "slow",
    startedAt: "2026-09-30T10:00:00.000Z",
    restored: true,
    followed: false,
    cancelledAt: undefined,
  };

  function panelWith(filled: boolean, busy: boolean) {
    const start = vi.fn();
    const view = render(
      <JobsPanel
        jobs={[job]}
        activeJob={undefined}
        dismissAdvertisedFor={() => "nothing"}
        messages={new Map()}
        onRemove={vi.fn()}
        onDismiss={vi.fn()}
        structured
        rerun={{ start, filled: () => filled, busy }}
      />,
    );
    return { view, start };
  }

  const buttonText = (view: HTMLElement) =>
    [...view.querySelectorAll(".actions button")].map((button) => button.textContent);

  it("says it runs again when this visit has the inputs, and starts it", () => {
    const { view, start } = panelWith(true, false);
    expect(buttonText(view)).toContain("Run again");
    act(() => {
      [...view.querySelectorAll<HTMLButtonElement>(".actions button")]
        .find((button) => button.textContent === "Run again")
        ?.click();
    });
    expect(start).toHaveBeenCalledWith(job);
  });

  it("says it only opens the process when the inputs are from an earlier visit", () => {
    expect(buttonText(panelWith(false, false).view)).toContain("Open the process");
  });

  it("can't be used while a run is under way", () => {
    const button = [
      ...panelWith(true, true).view.querySelectorAll<HTMLButtonElement>(".actions button"),
    ].find((candidate) => candidate.textContent === "Run again");
    expect(button?.disabled).toBe(true);
  });
});

describe("Copy on a result, in the updated Instrument", () => {
  const echo: RenderableResult = { kind: "json", outputId: "echo", value: { a: 1 } };
  const note: RenderableResult = {
    kind: "text",
    outputId: "note",
    value: "hello",
    mediaType: "text/plain",
  };

  function copyButtons(results: readonly RenderableResult[]) {
    const view = render(
      <UpdatedContext value>
        <ResultsView results={results} processId="p" onLoad={() => Promise.resolve()} />
      </UpdatedContext>,
    );
    return [...view.querySelectorAll<HTMLButtonElement>(".copy-button")];
  }

  it("is named for the result when there is one, and for each output when there are several", () => {
    expect(copyButtons([echo]).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy result",
    ]);
    expect(copyButtons([echo, note]).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy echo",
      "Copy note",
    ]);
  });

  it("has a tooltip in the same words, which Escape hides until the pointer comes back", () => {
    const [button] = copyButtons([echo]);
    const copy = button?.closest(".copy");
    const tip = copy?.querySelector(".copy-tip");
    expect(tip?.textContent).toBe("Copy result");
    // The name says it to a screen reader already.
    expect(tip?.getAttribute("aria-hidden")).toBe("true");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(copy?.hasAttribute("data-tip-hidden")).toBe(true);
    act(() => {
      copy?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(copy?.hasAttribute("data-tip-hidden")).toBe(false);
  });
});

describe("Copy in a text box of the form", () => {
  const plan = planFor({ city: { title: "City", schema: { type: "string" } } });
  const [field] = plan.fields;

  function box(updated: boolean, value: string | undefined) {
    if (field === undefined) throw new Error("no field");
    return render(
      <UpdatedContext value={updated}>
        <FieldView
          field={field}
          index={0}
          values={value === undefined ? {} : { city: value }}
          error={undefined}
          onChange={vi.fn()}
        />
      </UpdatedContext>,
    );
  }

  it("is in the box in the updated Instrument, named for the input, once there is text", () => {
    const view = box(true, "Delft");
    const button = view.querySelector(".copy-field > input + .copy .copy-button");
    expect(button?.getAttribute("aria-label")).toBe("Copy City");
    expect(box(true, undefined).querySelector(".copy-button")).toBeNull();
  });

  it("copies what the box shows", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
    const view = box(true, "Delft");
    await act(async () => {
      view.querySelector<HTMLButtonElement>(".copy-button")?.click();
      await Promise.resolve();
    });
    expect(copied).toEqual(["Delft"]);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("is not there in Instrument as it is, which keeps the box alone", () => {
    const view = box(false, "Delft");
    expect(view.querySelector(".copy-field, .copy-button")).toBeNull();
  });
});
