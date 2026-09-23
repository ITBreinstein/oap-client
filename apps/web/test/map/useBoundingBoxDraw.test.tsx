/**
 * The map binding with MapLibre and the draw engine stubbed: when the draw
 * mode exists, what it reports, and that it goes away — on `active` turning
 * false, on unmount — and that the map itself is removed on unmount.
 */

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeDrawField } from "../../src/app/draw.js";
import { bboxOfRing, roundBbox, sameBbox, type Bbox } from "../../src/map/bbox.js";
import type { DrawEngine } from "../../src/map/draw-engine.js";
import { MapView, type CreateMap } from "../../src/map/MapView.js";
import { useBoundingBoxDraw, type BboxDrawProps } from "../../src/map/useBoundingBoxDraw.js";

interface FakeEngine extends DrawEngine {
  readonly calls: string[];
  emit(bbox: Bbox): void;
}

function fakeEngine(): FakeEngine {
  const calls: string[] = [];
  let listener: ((bbox: Bbox) => void) | undefined;
  return {
    calls,
    drawRectangle: () => calls.push("draw"),
    show: (bbox) => calls.push(`show:${bbox === undefined ? "none" : bbox.join(",")}`),
    onChange: (next) => {
      listener = next;
    },
    stop: () => calls.push("stop"),
    emit: (bbox) => listener?.(bbox),
  };
}

const fakeMap = {} as never;

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

function Harness({ props, engine }: { props: BboxDrawProps; engine: () => DrawEngine }) {
  useBoundingBoxDraw(fakeMap, props, engine);
  return null;
}

describe("useBoundingBoxDraw", () => {
  it("does nothing until a field asks to draw", () => {
    const engine = fakeEngine();
    render(<Harness props={{ active: false, onChange: () => undefined }} engine={() => engine} />);
    expect(engine.calls).toEqual([]);
  });

  it("enters draw mode, showing the field's current box", () => {
    const engine = fakeEngine();
    const create = () => engine;
    render(
      <Harness
        props={{ active: true, value: [3, 50.7, 7, 53.6], onChange: () => undefined }}
        engine={create}
      />,
    );
    expect(engine.calls).toEqual(["show:3,50.7,7,53.6", "draw"]);
  });

  it("returns a drawn box as [minX, minY, maxX, maxY] in lon/lat order, rounded", () => {
    const engine = fakeEngine();
    const create = () => engine;
    const onChange = vi.fn();
    render(<Harness props={{ active: true, onChange }} engine={create} />);
    act(() => {
      engine.emit([3.1234567, 50.7, 7.0000001, 53.6]);
    });
    expect(onChange).toHaveBeenCalledWith([3.123457, 50.7, 7, 53.6]);
  });

  it("clears, and is ready to draw again", () => {
    const engine = fakeEngine();
    const create = () => engine;
    const onChange = () => undefined;
    render(<Harness props={{ active: true, value: [1, 1, 2, 2], onChange }} engine={create} />);
    render(<Harness props={{ active: true, value: undefined, onChange }} engine={create} />);
    expect(engine.calls.slice(-2)).toEqual(["show:none", "draw"]);
  });

  it("does not redraw a box the map itself just reported", () => {
    const engine = fakeEngine();
    const create = () => engine;
    const onChange = () => undefined;
    render(<Harness props={{ active: true, onChange }} engine={create} />);
    act(() => {
      engine.emit([1, 1, 2, 2]);
    });
    const before = engine.calls.length;
    render(<Harness props={{ active: true, value: [1, 1, 2, 2], onChange }} engine={create} />);
    expect(engine.calls.length).toBe(before);
  });

  it("removes the draw mode when the field stops drawing", () => {
    const engine = fakeEngine();
    const create = () => engine;
    const onChange = () => undefined;
    render(<Harness props={{ active: true, onChange }} engine={create} />);
    render(<Harness props={{ active: false, onChange }} engine={create} />);
    expect(engine.calls.at(-1)).toBe("stop");
  });

  it("removes the draw mode on unmount", () => {
    // Reduction test (d) breaks exactly this.
    const engine = fakeEngine();
    const create = () => engine;
    render(<Harness props={{ active: true, onChange: () => undefined }} engine={create} />);
    act(() => {
      root?.unmount();
    });
    root = undefined;
    expect(engine.calls.at(-1)).toBe("stop");
  });

  it("survives StrictMode's double effect: one engine left running, not two", () => {
    const engines: FakeEngine[] = [];
    const create = () => {
      const engine = fakeEngine();
      engines.push(engine);
      return engine;
    };
    render(
      <StrictMode>
        <Harness props={{ active: true, onChange: () => undefined }} engine={create} />
      </StrictMode>,
    );
    const running = engines.filter((engine) => engine.calls.at(-1) !== "stop");
    expect(running).toHaveLength(1);
  });
});

describe("the draw mode ends when the chosen process changes", () => {
  it("is active only for the form it was started in", () => {
    const formA = {};
    const formB = {};
    const request = { form: formA, fieldId: "bbox" };
    expect(activeDrawField(request, formA)).toBe("bbox");
    // Another process opened, the same process reopened, or no form at all.
    expect(activeDrawField(request, formB)).toBeUndefined();
    expect(activeDrawField(request, undefined)).toBeUndefined();
  });
});

describe("MapView", () => {
  it("removes the map on unmount", () => {
    const remove = vi.fn();
    const createMap: CreateMap = () => ({ remove }) as never;
    const onAvailable = vi.fn();
    render(
      <MapView
        createMap={createMap}
        createEngine={() => fakeEngine()}
        onAvailable={onAvailable}
        draw={{ active: false, onChange: () => undefined }}
      />,
    );
    expect(onAvailable).toHaveBeenLastCalledWith(true);
    act(() => {
      root?.unmount();
    });
    root = undefined;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(onAvailable).toHaveBeenLastCalledWith(false);
  });

  it("says so, and leaves typed coordinates as the way in, when the map cannot start", () => {
    const createMap: CreateMap = () => {
      throw new Error("WebGL is not available");
    };
    const onAvailable = vi.fn();
    render(
      <MapView
        createMap={createMap}
        onAvailable={onAvailable}
        draw={{ active: false, onChange: () => undefined }}
      />,
    );
    expect(host?.textContent).toContain("The map could not be started (WebGL is not available)");
    expect(onAvailable).toHaveBeenLastCalledWith(false);
  });
});

describe("bbox helpers", () => {
  it("find the box around a ring in any winding", () => {
    expect(
      bboxOfRing([
        [7, 50.7],
        [3, 53.6],
        [5, 52],
      ]),
    ).toEqual([3, 50.7, 7, 53.6]);
    expect(bboxOfRing([])).toBeUndefined();
  });

  it("round to six decimals and compare with a tolerance", () => {
    expect(roundBbox([1.23456789, 0, 0, 0])).toEqual([1.234568, 0, 0, 0]);
    expect(sameBbox([1, 2, 3, 4], [1, 2, 3, 4])).toBe(true);
    expect(sameBbox([1, 2, 3, 4], undefined)).toBe(false);
  });
});
