/**
 * GeoJSON drawing with the engine stubbed: when the draw mode exists, what it
 * shows, that a value it produced itself is not redrawn, and that it goes away.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CreateGeometryEngine,
  GeometryEngine,
  GeometryEngineOptions,
  MapShape,
} from "../../src/map/geometry-engine.js";
import { useGeometryDraw, type GeometryDrawProps } from "../../src/map/useGeometryDraw.js";

interface FakeEngine extends GeometryEngine {
  readonly calls: string[];
  readonly options: GeometryEngineOptions[];
  /** The factory, made once, as MapView's default is: a new one restarts drawing. */
  readonly create: CreateGeometryEngine;
  emit(shapes: readonly MapShape[]): void;
}

function fakeEngine(): FakeEngine {
  const calls: string[] = [];
  const options: GeometryEngineOptions[] = [];
  let listener: ((shapes: readonly MapShape[]) => void) | undefined;
  const engine: FakeEngine = {
    calls,
    options,
    create: (_map, given) => {
      options.push(given);
      return engine;
    },
    place: (tool) => calls.push(`place:${tool}`),
    show: (shapes) => calls.push(`show:${String(shapes.length)}`),
    deleteSelected: () => calls.push("delete"),
    onChange: (next) => {
      listener = next;
    },
    onState: () => undefined,
    stop: () => calls.push("stop"),
    emit: (shapes) => listener?.(shapes),
  };
  return engine;
}

const fakeMap = {} as never;

const point: MapShape = { type: "Point", coordinates: [5.1, 52.1] };
const other: MapShape = { type: "Point", coordinates: [5.2, 52.2] };

let root: Root | undefined;
let host: HTMLElement | undefined;

function render(element: React.ReactNode) {
  host ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(host);
  act(() => {
    root?.render(element);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  host?.remove();
  host = undefined;
});

function Harness({ props, engine }: { props: GeometryDrawProps; engine: FakeEngine }) {
  useGeometryDraw(fakeMap, props, engine.create);
  return null;
}

const props = (overrides: Partial<GeometryDrawProps>): GeometryDrawProps => ({
  active: true,
  tools: ["Point"],
  several: false,
  value: [],
  onChange: () => undefined,
  ...overrides,
});

describe("useGeometryDraw", () => {
  it("does nothing until a field asks to draw", () => {
    const engine = fakeEngine();
    render(<Harness props={props({ active: false })} engine={engine} />);
    expect(engine.calls).toEqual([]);
  });

  it("starts with the offered tools, showing the field's shapes", () => {
    const engine = fakeEngine();
    render(
      <Harness props={props({ tools: ["Point", "Polygon"], value: [point] })} engine={engine} />,
    );
    expect(engine.options).toEqual([{ tools: ["Point", "Polygon"], several: false }]);
    expect(engine.calls).toEqual(["show:1"]);
  });

  it("reports what was drawn, and does not redraw it when it comes back as the value", () => {
    const engine = fakeEngine();
    const seen: unknown[] = [];
    const onChange = (shapes: readonly MapShape[]) => seen.push(shapes);
    render(<Harness props={props({ onChange })} engine={engine} />);
    act(() => {
      engine.emit([point]);
    });
    render(<Harness props={props({ onChange, value: [point] })} engine={engine} />);
    expect(seen).toEqual([[point]]);
    expect(engine.calls).toEqual(["show:0"]);
  });

  it("shows a value set from outside: a loaded file, typed GeoJSON, Clear", () => {
    const engine = fakeEngine();
    render(<Harness props={props({ value: [point] })} engine={engine} />);
    render(<Harness props={props({ value: [point, other] })} engine={engine} />);
    render(<Harness props={props({ value: [] })} engine={engine} />);
    expect(engine.calls).toEqual(["show:1", "show:2", "show:0"]);
  });

  it("removes the draw mode when drawing stops", () => {
    const engine = fakeEngine();
    render(<Harness props={props({})} engine={engine} />);
    render(<Harness props={props({ active: false })} engine={engine} />);
    expect(engine.calls.at(-1)).toBe("stop");
  });
});
