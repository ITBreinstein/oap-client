/**
 * A clicked result feature's properties, beside the map (package 5): text
 * only, nested values as formatted JSON, and a plain word when there are none.
 * And the map pane's part: a click picks the feature by its index, and a new
 * result drops the pick.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureProperties } from "../../src/app/FeatureProperties.js";
import type { MapViewProps } from "../../src/map/MapView.js";
import type { PlottedFeature } from "../../src/results/plottable.js";
import type { RenderableResult } from "../../src/results/renderable.js";

// The map pane without MapLibre: the stand-in keeps the props it was given.
const mapProps: { current: MapViewProps | undefined } = { current: undefined };
vi.mock("../../src/map/MapView.js", () => ({
  MapView: (props: MapViewProps) => {
    mapProps.current = props;
    return null;
  },
}));

const { MapPane } = await import("../../src/app/MapPane.js");
const { workflowReducer } = await import("../../src/app/workflow.js");
const { initialValues } = await import("../../src/forms/defaults.js");
const { resolveFormPlan } = await import("../../src/forms/resolve.js");
const { fixtureProcess } = await import("../forms/helpers.js");

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
  mapProps.current = undefined;
});

const point = { type: "Point" as const, coordinates: [5, 52] };

function feature(properties: unknown): PlottedFeature {
  return { outputId: "features", shape: point, origin: { kind: "feature", properties } };
}

describe("FeatureProperties", () => {
  it("shows a property that looks like markup as the literal text it is", () => {
    const view = render(
      <FeatureProperties
        feature={feature({ name: "<img src=x onerror=alert(1)>" })}
        onClose={vi.fn()}
      />,
    );
    expect(view.querySelector("dd")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(view.querySelector("img")).toBeNull();
  });

  it("shows a nested value as formatted JSON text, and plain values as they are", () => {
    const view = render(
      <FeatureProperties
        feature={feature({
          height: 12.5,
          listed: false,
          owner: null,
          address: { street: "<b>Main</b>", number: 1 },
        })}
        onClose={vi.fn()}
      />,
    );
    const values = [...view.querySelectorAll("dd")].map((dd) => dd.textContent);
    expect(values).toEqual([
      // A number the Dutch way (#20).
      "12,5",
      "false",
      "null",
      '{\n  "street": "<b>Main</b>",\n  "number": 1\n}',
    ]);
    expect(view.querySelector("b")).toBeNull();
    expect([...view.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
      "height",
      "listed",
      "owner",
      "address",
    ]);
  });

  it("links a web address, groups a large number's digits, lists a short list (#20)", () => {
    const view = render(
      <FeatureProperties
        feature={feature({
          page: "https://bag.basisregistraties.overheid.nl/pand/0363100012165490",
          oppervlakte: 125430.5,
          bouwjaar: 1923,
          gebruik: ["wonen", "kantoor"],
          code: "javascript:alert(1)",
        })}
        onClose={vi.fn()}
      />,
    );
    const values = [...view.querySelectorAll("dd")];
    const link = values[0]?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "https://bag.basisregistraties.overheid.nl/pand/0363100012165490",
    );
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(values.slice(1).map((dd) => dd.textContent)).toEqual([
      "125.430,5",
      "1923",
      "wonen, kantoor",
      "javascript:alert(1)",
    ]);
    expect(values[4]?.querySelector("a")).toBeNull();
  });

  it("sits on the side it is given, the left one unless told", () => {
    const left = render(<FeatureProperties feature={feature({ a: 1 })} onClose={vi.fn()} />);
    expect(left.querySelector("section")?.dataset["side"]).toBe("left");
    act(() => {
      root?.unmount();
    });
    const right = render(
      <FeatureProperties feature={feature({ a: 1 })} side="right" onClose={vi.fn()} />,
    );
    expect(right.querySelector("section")?.dataset["side"]).toBe("right");
  });

  it("says so when there are no properties: null, empty, or a bare geometry", () => {
    for (const properties of [null, {}]) {
      const view = render(<FeatureProperties feature={feature(properties)} onClose={vi.fn()} />);
      expect(view.textContent).toContain("This feature has no properties.");
      act(() => {
        root?.unmount();
      });
    }
    const bare = render(
      <FeatureProperties
        feature={{ outputId: "rotated", shape: point, origin: { kind: "bare-geometry" } }}
        onClose={vi.fn()}
      />,
    );
    expect(bare.textContent).toContain("bare geometry, not a feature, so it has no properties");
  });
});

describe("the map pane's feature pick", () => {
  const endpoint = { source: "typed", baseUrl: "http://localhost:5080" } as const;
  const service: ServiceDescription = {
    url: "http://localhost:5080/",
    links: [],
    capabilities: unknownCapabilities(),
  };
  const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };

  function withResults(results: RenderableResult[]) {
    const process = fixtureProcess("pygeoapi/breinstein-inputs");
    const plan = resolveFormPlan(process);
    return [
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
      { type: "run-started", runId: "run-1", mode: "sync" },
      { type: "results", runId: "run-1", results },
    ].reduce(workflowReducer as never, { stage: "choose-endpoint" });
  }

  const collection = (name: string): RenderableResult => ({
    kind: "json",
    outputId: "features",
    value: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: `${name}-0` }, geometry: point },
        { type: "Feature", properties: { name: `${name}-1` }, geometry: point },
      ],
    },
  });

  function pane(state: unknown) {
    return (
      <MapPane
        state={state as never}
        draw={{ fieldId: undefined, available: true, start: vi.fn(), stop: vi.fn() }}
        setValue={vi.fn()}
        onAvailable={vi.fn()}
      />
    );
  }

  it("shows the clicked feature's properties, and forgets the pick when the result changes", () => {
    const first = withResults([collection("first")]);
    const view = render(pane(first));
    expect(view.querySelector('[data-testid="feature-hint"]')).not.toBeNull();

    act(() => {
      // On the map's left half: the properties go to the right (#20).
      mapProps.current?.onResultClick?.(1, { x: 120, width: 800 });
    });
    expect(view.querySelector('[data-testid="feature-properties"] dd')?.textContent).toBe(
      "first-1",
    );
    expect(
      view.querySelector<HTMLElement>('[data-testid="feature-properties"]')?.dataset["side"],
    ).toBe("right");
    // The map outlines the clicked shape meanwhile.
    expect(mapProps.current?.selected).toBe(1);
    act(() => {
      mapProps.current?.onResultClick?.(0, { x: 700, width: 800 });
    });
    expect(
      view.querySelector<HTMLElement>('[data-testid="feature-properties"]')?.dataset["side"],
    ).toBe("left");

    act(() => {
      root?.render(pane(withResults([collection("second")])));
    });
    expect(view.querySelector('[data-testid="feature-properties"]')).toBeNull();
    expect(mapProps.current?.selected).toBeUndefined();
  });

  it("invites a click only when a shape has properties to show (#21)", () => {
    const bare: RenderableResult = {
      kind: "json",
      outputId: "rotated",
      value: {
        type: "Polygon",
        coordinates: [
          [
            [5, 52],
            [5.1, 52],
            [5.1, 52.1],
            [5, 52],
          ],
        ],
      },
    };
    const empty: RenderableResult = {
      kind: "json",
      outputId: "features",
      value: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: point }],
      },
    };
    const view = render(pane(withResults([bare, empty])));
    expect(mapProps.current?.shown?.some((set) => set.role === "result")).toBe(true);
    expect(view.querySelector('[data-testid="feature-hint"]')).toBeNull();
  });
});
