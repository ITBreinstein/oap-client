/**
 * Task 8 on screen: "Load" is the only thing that fetches (T3), what went
 * wrong is said with a link to open (T4, T7), truncation is never silent (T6),
 * and the Value/Link choice follows the description (T2).
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessScreen } from "../../src/app/ProcessScreen.js";
import { ResultsView } from "../../src/app/ResultsView.js";
import { UpdatedContext } from "../../src/app/variant.js";
import type { WorkflowCommands } from "../../src/app/useWorkflow.js";
import { workflowReducer, type Workflow, type WorkflowAction } from "../../src/app/workflow.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import type { LoadedReference } from "../../src/results/reference.js";
import type { RenderableResult } from "../../src/results/renderable.js";
import { fixtureProcess } from "../forms/helpers.js";

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

const NOT_LOADED: LoadedReference = {
  outcome: "ok",
  route: undefined,
  representation: undefined,
  mediaType: undefined,
  status: undefined,
  detail: undefined,
  blob: undefined,
  geojson: undefined,
  contentCrs: undefined,
  axes: undefined,
  page: undefined,
  itemsUrl: undefined,
};

function referenceTo(
  href: string,
  loaded?: Partial<LoadedReference>,
): Extract<RenderableResult, { kind: "reference" }> {
  return {
    kind: "reference",
    outputId: "file",
    href,
    mediaType: "image/png",
    ...(loaded === undefined ? {} : { loaded: { ...NOT_LOADED, ...loaded } }),
  };
}

describe("a result given by reference", () => {
  it("fetches nothing until Load is clicked, and then only that output", () => {
    const onLoad = vi.fn(() => Promise.resolve());
    const view = render(
      <ResultsView
        results={[referenceTo("http://localhost:5081/static/img/logo.png")]}
        processId="breinstein-link"
        onLoad={onLoad}
      />,
    );
    expect(onLoad).not.toHaveBeenCalled();
    const load = [...view.querySelectorAll("button")].find(
      (button) => button.textContent === "Load",
    );
    act(() => {
      load?.click();
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledWith("file");
  });

  it("says a blocked Load was blocked, and offers the link to open in a new tab", () => {
    const href = "http://localhost:5081/static/img/logo.png";
    const view = render(
      <ResultsView
        results={[referenceTo(href, { outcome: "cors-blocked", route: "direct" })]}
        processId="breinstein-link"
        onLoad={() => Promise.resolve()}
      />,
    );
    const item = view.querySelector('[data-output-id="file"]');
    expect(item?.getAttribute("data-reference-outcome")).toBe("cors-blocked");
    expect(item?.textContent).toContain(
      "localhost:5081 sends no CORS headers for it, or could not be reached",
    );
    const link = item?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(href);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    // Loaded, if blocked: no second Load.
    expect([...view.querySelectorAll("button")].some((b) => b.textContent === "Load")).toBe(false);
  });

  it("makes nothing clickable that is not http or https", () => {
    const view = render(
      <ResultsView
        results={[referenceTo("javascript:alert(1)")]}
        processId="p"
        onLoad={() => Promise.resolve()}
      />,
    );
    expect(view.querySelector("a")).toBeNull();
  });

  it("shows an error page's body as text, never as markup", () => {
    const view = render(
      <ResultsView
        results={[
          referenceTo("https://x.test/a", {
            outcome: "http-error",
            status: 500,
            detail: "<b>Internal Server Error</b><script>alert(1)</script>",
          }),
        ]}
        processId="p"
        onLoad={() => Promise.resolve()}
      />,
    );
    expect(view.querySelector("b")).toBeNull();
    expect(view.querySelector("script")).toBeNull();
    expect(view.querySelector("pre")?.textContent).toContain("<b>Internal Server Error</b>");
    expect(view.textContent).toContain("x.test answered HTTP 500.");
  });

  it("says a page is the first page only (T6)", () => {
    const geojson = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5, 52] } },
      ],
    };
    const view = render(
      <ResultsView
        results={[
          referenceTo("https://x.test/items", {
            representation: "geojson",
            geojson,
            axes: "as-is",
            page: { returned: 10, matched: undefined, hasNext: true },
          }),
        ]}
        processId="p"
        onLoad={() => Promise.resolve()}
      />,
    );
    expect(view.querySelector("[data-truncated]")?.textContent).toBe(
      "First page only: 10 features. The server has more; this page loads one page.",
    );
    expect(view.querySelector('[data-output-id="file"]')?.getAttribute("data-plotted")).toBe(
      "true",
    );
  });

  it("says how many of how many when the server says (T6)", () => {
    const view = render(
      <ResultsView
        results={[
          referenceTo("https://x.test/items", {
            representation: "geojson",
            geojson: { type: "Point", coordinates: [5, 52] },
            axes: "as-is",
            page: { returned: 10, matched: 25, hasNext: true },
          }),
        ]}
        processId="p"
        onLoad={() => Promise.resolve()}
      />,
    );
    expect(view.querySelector("[data-truncated]")?.textContent).toBe("Showing 10 of 25 features.");
  });
});

describe("the Value/Link choice (T2)", () => {
  const endpoint = { source: "typed", baseUrl: "http://localhost:5090/ogc-api" } as const;
  const service: ServiceDescription = {
    url: "http://localhost:5090/ogc-api/",
    links: [],
    capabilities: unknownCapabilities(),
  };
  const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };

  /** The same service, spoken to as the 2.0 draft, which has no `transmissionMode`. */
  const draftService: ServiceDescription = {
    ...service,
    capabilities: {
      ...unknownCapabilities(),
      protocolVersion: "2.0-draft",
      versionSource: "declared",
    },
  };

  function openState(key: string, draft = false): Extract<Workflow, { stage: "process" }> {
    const process = fixtureProcess(key);
    const plan = resolveFormPlan(process);
    const connectedTo = draft ? draftService : service;
    const actions: WorkflowAction[] = [
      { type: "connect", endpoint },
      {
        type: "connected",
        connection: 1,
        endpoint,
        route: "direct",
        service: connectedTo,
        processes,
      },
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
    if (state.stage !== "process") throw new Error("not open");
    return state;
  }

  const commands = new Proxy({} as WorkflowCommands, { get: () => vi.fn() });

  function screen(key: string, developer: boolean, draft = false, updated = false): HTMLElement {
    return render(
      <UpdatedContext value={updated}>
        <ProcessScreen
          state={openState(key, draft)}
          commands={commands}
          fieldErrors={new Map()}
          jobs={[]}
          jobNotice={undefined}
          dismissAdvertisedBy="nothing"
          developer={developer}
        />
      </UpdatedContext>,
    );
  }

  for (const updated of [false, true]) {
    const version = updated ? "Instrument (updated)" : "Instrument";
    it(`turns Link off on a 2.0 draft service, and says why (${version})`, () => {
      const view = screen("zoo-project/echo", false, true, updated);
      const reason = view.querySelector('[data-testid="no-link-reason"]');
      expect(reason?.textContent).toBe(
        "This service's version of the standard doesn't let the page ask for a link instead of the data.",
      );
      for (const choice of view.querySelectorAll("[data-output-choice]")) {
        const [value, link] = choice.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        expect(value?.disabled).toBe(false);
        expect(value?.checked).toBe(true);
        expect(link?.disabled).toBe(true);
        // Read with the control, not only near it.
        expect(link?.getAttribute("aria-describedby")).toBe(reason?.id);
      }
    });
  }

  it("turns the developer view's link-anyway off on a 2.0 draft service too", () => {
    const view = screen("pygeoapi/breinstein-inputs", true, true);
    const boxes = view.querySelectorAll<HTMLInputElement>(
      '.outputs.developer input[type="checkbox"]',
    );
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box.disabled).toBe(true);
    expect(view.querySelector('[data-testid="no-link-reason"]')).not.toBeNull();
  });

  it("leaves Link on, with no reason, on a 1.0 service", () => {
    const view = screen("zoo-project/echo", false);
    expect(view.querySelector('[data-testid="no-link-reason"]')).toBeNull();
    const link = view.querySelectorAll<HTMLInputElement>(
      '[data-output-choice] input[type="radio"]',
    )[1];
    expect(link?.disabled).toBe(false);
  });

  it("offers Value or Link per output where the description allows a reference", () => {
    const view = screen("zoo-project/echo", false);
    const choices = view.querySelectorAll("[data-output-choice]");
    expect([...choices].map((choice) => choice.getAttribute("data-output-choice"))).toEqual([
      "a",
      "b",
      "c",
    ]);
    const value = choices[0]?.querySelectorAll<HTMLInputElement>('input[type="radio"]')[0];
    expect(value?.checked).toBe(true);
  });

  it("offers nothing where it does not, as on every pygeoapi process (finding 0059)", () => {
    const view = screen("pygeoapi/breinstein-inputs", false);
    expect(view.querySelector(".outputs")).toBeNull();
  });

  it("offers the developer view a link anyway, and says it goes beyond the description", () => {
    const view = screen("pygeoapi/breinstein-inputs", true);
    const section = view.querySelector(".outputs.developer");
    expect(section?.textContent).toContain("Developer: ask for a link anyway");
    expect(section?.textContent).toContain("it declares value");
    expect(section?.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });
});
