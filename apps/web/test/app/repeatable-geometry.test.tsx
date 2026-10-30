/**
 * A repeatable geometry input (3.4): the map draws for one row at a time — the
 * row whose "Draw on the map" was pressed — and shows every other row as the
 * input's outline. Rows are known by their index, so removing any row ends
 * drawing. The map side is driven in a real browser in
 * `e2e/geojson-inputs.spec.ts`.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DrawContext, type DrawTarget } from "../../src/app/draw.js";
import { FieldView } from "../../src/app/FormFields.js";
import { remember, restoredValues, formKey } from "../../src/app/form-memory.js";
import { fieldTexts, shapeBinding, shownOnMap } from "../../src/app/input-shapes.js";
import { drawsOnMap } from "../../src/app/map-need.js";
import { leftOffTheMap, shownFor } from "../../src/app/MapPane.js";
import {
  INITIAL_WORKFLOW,
  workflowReducer,
  type EndpointRef,
  type WorkflowAction,
} from "../../src/app/workflow.js";
import { initialValues } from "../../src/forms/defaults.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess } from "../forms/helpers.js";

const process = fixtureProcess("beleidsnormen/rustplekken");
const plan = resolveFormPlan(process);
const benches = plan.fields.find((field) => field.id === "nieuwe_bankjes");
const area = plan.fields.find((field) => field.id === "geometry");
if (benches === undefined || area === undefined) throw new Error("rustplekken changed");

function points(...coordinates: (readonly [number, number])[]) {
  return {
    geojson: JSON.stringify({
      type: "FeatureCollection",
      features: coordinates.map((at) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: at },
      })),
    }),
  };
}

const first = points([4.744, 52.6305]);
const second = points([4.7452, 52.6318], [4.746, 52.632]);

describe("binding one row", () => {
  it("draws for the row asked for, and writes back only that row", () => {
    const binding = shapeBinding(benches, [first, second], 1);
    expect(binding?.target).toMatchObject({ wrapper: "feature-collection" });
    expect(binding?.text).toBe(second.geojson);
    expect(binding?.write(first.geojson)).toEqual([first, first]);
    expect(binding?.write("")).toEqual([first, undefined]);
  });

  it("binds nothing without a row, or for a row the list does not have", () => {
    expect(shapeBinding(benches, [first])).toBeUndefined();
    expect(shapeBinding(benches, [first], 1)).toBeUndefined();
    expect(shapeBinding(benches, undefined, 0)).toBeUndefined();
  });

  it("lists every row's GeoJSON but the one being drawn", () => {
    expect(fieldTexts(benches, [first, second])).toEqual([
      { text: first.geojson, row: 0 },
      { text: second.geojson, row: 1 },
    ]);
    expect(fieldTexts(benches, [first, second], 0)).toEqual([{ text: second.geojson, row: 1 }]);
  });

  it("puts the map on screen for it, and says a sent value is on the map", () => {
    expect(drawsOnMap(benches)).toBe(true);
    expect(shownOnMap(benches, [undefined, second], 1000)).toBe(true);
    expect(shownOnMap(benches, [undefined], 1000)).toBe(false);
  });
});

describe("the input layer, for a repeatable geometry", () => {
  const endpoint: EndpointRef = { source: "typed", baseUrl: "http://localhost:5080" };
  const service: ServiceDescription = {
    url: "http://localhost:5080/",
    links: [],
    capabilities: unknownCapabilities(),
  };
  const processes: ProcessList = { processes: [], links: [], pageCount: 1, truncated: false };
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
    { type: "set-value", id: benches.id, value: [first, second] },
  ];
  const state = actions.reduce(workflowReducer, INITIAL_WORKFLOW);
  const inputs = (sets: ReturnType<typeof shownFor>) =>
    sets.find((set) => set.role === "input")?.shapes.length;

  it("shows every row while none is drawn, and all but the drawn row while one is", () => {
    expect(inputs(shownFor(state))).toBe(3);
    expect(inputs(shownFor(state, benches.id, Number.POSITIVE_INFINITY, 1))).toBe(1);
    expect(inputs(shownFor(state, benches.id, Number.POSITIVE_INFINITY, 0))).toBe(2);
  });

  it("names the row it leaves off the map for having too many positions", () => {
    expect(leftOffTheMap(state, 1)).toEqual([{ name: `${benches.title}, value 2`, positions: 2 }]);
  });
});

describe("a row's Draw on the map", () => {
  const calls: { started: [string, number | undefined][]; stopped: number } = {
    started: [],
    stopped: 0,
  };
  let root: Root | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    calls.started = [];
    calls.stopped = 0;
  });

  function Harness({ drawingRow }: { readonly drawingRow: number | undefined }) {
    const [value, setValue] = useState<unknown>([first, second]);
    const draw: DrawTarget = {
      fieldId: drawingRow === undefined ? undefined : benches?.id,
      row: drawingRow,
      available: true,
      start: (fieldId, row) => {
        calls.started.push([fieldId, row]);
      },
      stop: () => {
        calls.stopped += 1;
      },
    };
    if (benches === undefined) throw new Error("no benches");
    return (
      <DrawContext value={draw}>
        <FieldView
          field={benches}
          index={0}
          values={{ [benches.id]: value }}
          error={undefined}
          onChange={(_id, next) => {
            setValue(next);
          }}
        />
      </DrawContext>
    );
  }

  function render(drawingRow?: number): HTMLElement {
    host = document.createElement("div");
    document.body.append(host);
    const created = createRoot(host);
    root = created;
    act(() => {
      created.render(<Harness drawingRow={drawingRow} />);
    });
    return host;
  }

  const drawButtons = (element: HTMLElement) =>
    [...element.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].map((button) => ({
      name: button.getAttribute("aria-label") ?? button.textContent,
      pressed: button.getAttribute("aria-pressed"),
    }));

  it("is one per row, named by its row, and starts drawing for that row", () => {
    const element = render();
    expect(drawButtons(element)).toEqual([
      { name: "Draw on the map, value 1", pressed: "false" },
      { name: "Draw on the map, value 2", pressed: "false" },
    ]);
    act(() => {
      element.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")[1]?.click();
    });
    expect(calls.started).toEqual([[benches.id, 1]]);
  });

  it("is pressed only on the row being drawn", () => {
    expect(drawButtons(render(1)).map((button) => button.pressed)).toEqual(["false", "true"]);
  });

  it("stops when any row is removed, the drawn one or another", () => {
    const element = render(1);
    const remove = [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "Remove value 1",
    );
    act(() => {
      remove?.click();
    });
    expect(calls.stopped).toBe(1);
  });

  it("keeps drawing when a row is added at the end", () => {
    const element = render(0);
    const add = [...element.querySelectorAll("button")].find(
      (button) => button.textContent === "Add a value",
    );
    act(() => {
      add?.click();
    });
    expect(calls.stopped).toBe(0);
    expect(drawButtons(element)).toHaveLength(3);
  });
});

describe("form memory (#10)", () => {
  it("brings every row's shapes back when the process is opened again", () => {
    const initial = initialValues(plan);
    const values = { ...initial, [benches.id]: [first, second] };
    const key = formKey("https://example.org/api/", process.id);
    const memory = remember(new Map(), key, values, initial);
    expect(restoredValues(plan, initial, memory.get(key))[benches.id]).toEqual([first, second]);
  });
});
