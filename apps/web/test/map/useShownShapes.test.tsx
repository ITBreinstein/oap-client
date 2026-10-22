/**
 * Shown shapes with the layers stubbed: what they are handed, when the map
 * moves, and when the count of result shapes can be trusted.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapShape } from "../../src/map/geometry-engine.js";
import type {
  ClickPlace,
  CreateShapeLayers,
  ShapeLayers,
  ShownImage,
  ShownShapes,
} from "../../src/map/shape-layers.js";
import { INPUT_SETTLE_MS, useShownShapes } from "../../src/map/useShownShapes.js";

interface FakeLayers extends ShapeLayers {
  readonly shown: (readonly ShownShapes[])[];
  readonly images: (ShownImage | undefined)[];
  readonly create: CreateShapeLayers;
  stopped: boolean;
  becomeReady(): void;
  /** What a click on result shape `index` would do. */
  click(index: number): void;
  /** What was outlined, in order (#20). */
  readonly selected: (number | undefined)[];
}

function fakeLayers(): FakeLayers {
  let ready: (() => void) | undefined;
  let clicked: ((index: number, at: ClickPlace) => void) | undefined;
  const layers: FakeLayers = {
    shown: [],
    images: [],
    selected: [],
    stopped: false,
    create: () => layers,
    show: (sets) => layers.shown.push(sets),
    showImage: (image) => layers.images.push(image),
    onReady: (listener) => {
      ready = listener;
    },
    onResultClick: (listener) => {
      clicked = listener;
    },
    select: (index) => {
      layers.selected.push(index);
    },
    stop: () => {
      layers.stopped = true;
    },
    becomeReady: () => ready?.(),
    click: (index) => clicked?.(index, { x: 10, width: 100 }),
  };
  return layers;
}

function fakeMap() {
  const fitted: unknown[] = [];
  return { fitted, map: { fitBounds: (bounds: unknown) => fitted.push(bounds) } };
}

const drawn: MapShape = {
  type: "Polygon",
  coordinates: [
    [
      [5, 52],
      [5.2, 52],
      [5.2, 52.1],
      [5, 52],
    ],
  ],
};
const turned: MapShape = { type: "Point", coordinates: [5.3, 52.3] };

let root: Root | undefined;
let host: HTMLElement | undefined;

/** The hook's count, as the harness renders it. */
function count(): number {
  return Number(host?.querySelector("[data-count]")?.getAttribute("data-count") ?? -1);
}

function Harness(props: {
  map: unknown;
  sets: readonly ShownShapes[];
  image?: ShownImage;
  layers: FakeLayers;
  onResultClick?: (index: number, at: ClickPlace) => void;
  selected?: number;
}) {
  const { resultShapes, resultImage } = useShownShapes(
    props.map as never,
    props.sets,
    props.image,
    props.layers.create,
    props.onResultClick,
    props.selected,
  );
  return <span data-count={resultShapes} data-image={String(resultImage)} />;
}

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

describe("useShownShapes", () => {
  it("shows the input, then the result, and moves the map only once there is a result", () => {
    const layers = fakeLayers();
    const { map, fitted } = fakeMap();
    const input: ShownShapes[] = [{ role: "input", shapes: [drawn] }];
    render(<Harness map={map} sets={input} layers={layers} />);
    expect(layers.shown.at(-1)).toEqual(input);
    expect(fitted).toEqual([]);

    const both: ShownShapes[] = [...input, { role: "result", shapes: [turned] }];
    render(<Harness map={map} sets={both} layers={layers} />);
    expect(layers.shown.at(-1)).toEqual(both);
    // Around the input and the result together.
    expect(fitted).toEqual([
      [
        [5, 52],
        [5.3, 52.3],
      ],
    ]);
  });

  it("counts result shapes only once the layers are on the map", () => {
    const layers = fakeLayers();
    const sets: ShownShapes[] = [{ role: "result", shapes: [turned, drawn] }];
    render(<Harness map={fakeMap().map} sets={sets} layers={layers} />);
    expect(count()).toBe(0);
    act(() => {
      layers.becomeReady();
    });
    expect(count()).toBe(2);
  });

  it("hands a result click to the latest handler, without making the layers again", () => {
    const layers = fakeLayers();
    const { map } = fakeMap();
    const first = vi.fn();
    const second = vi.fn();
    render(<Harness map={map} sets={[]} layers={layers} onResultClick={first} />);
    render(<Harness map={map} sets={[]} layers={layers} onResultClick={second} />);
    layers.click(3);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(3, { x: 10, width: 100 });
    expect(layers.stopped).toBe(false);
  });

  it("outlines the selected result shape, and none when it is put down (#20)", () => {
    const layers = fakeLayers();
    const { map } = fakeMap();
    render(<Harness map={map} sets={[]} layers={layers} selected={1} />);
    render(<Harness map={map} sets={[]} layers={layers} />);
    expect(layers.selected).toEqual([1, undefined]);
  });

  it("does nothing without a map, and takes the layers off when unmounted", () => {
    const layers = fakeLayers();
    render(<Harness map={undefined} sets={[]} layers={layers} />);
    expect(layers.shown).toEqual([]);

    render(<Harness map={fakeMap().map} sets={[]} layers={layers} />);
    act(() => {
      root?.unmount();
    });
    root = undefined;
    expect(layers.stopped).toBe(true);
  });

  it("hands the image over, moves the map to it, and says it is shown once ready", () => {
    const layers = fakeLayers();
    const { map, fitted } = fakeMap();
    const image: ShownImage = {
      url: "data:image/jpeg;base64,AA==",
      bounds: [5.1, 52.08, 5.14, 52.1],
    };
    render(<Harness map={map} sets={[]} image={image} layers={layers} />);
    expect(layers.images.at(-1)).toEqual(image);
    expect(fitted).toEqual([
      [
        [5.1, 52.08],
        [5.14, 52.1],
      ],
    ]);
    expect(host?.querySelector("[data-image]")?.getAttribute("data-image")).toBe("false");
    act(() => {
      layers.becomeReady();
    });
    expect(host?.querySelector("[data-image]")?.getAttribute("data-image")).toBe("true");

    render(<Harness map={map} sets={[]} layers={layers} />);
    expect(layers.images.at(-1)).toBeUndefined();
  });
});

describe("an input set from outside the map (#19)", () => {
  /** A map showing west, south, east, north, that records where it was moved. */
  function viewMap(view: [number, number, number, number]) {
    const fitted: unknown[] = [];
    return {
      fitted,
      map: {
        fitBounds: (bounds: unknown) => fitted.push(bounds),
        getBounds: () => ({
          getWest: () => view[0],
          getSouth: () => view[1],
          getEast: () => view[2],
          getNorth: () => view[3],
        }),
      },
    };
  }
  const far: MapShape = { type: "Point", coordinates: [2.17, 41.39] };

  it("moves the map to it once it has settled, not on every change", () => {
    vi.useFakeTimers();
    try {
      const layers = fakeLayers();
      const { map, fitted } = viewMap([4, 51, 6, 53]);
      render(<Harness map={map} sets={[{ role: "input", shapes: [drawn] }]} layers={layers} />);
      render(<Harness map={map} sets={[{ role: "input", shapes: [far] }]} layers={layers} />);
      act(() => {
        vi.advanceTimersByTime(INPUT_SETTLE_MS - 1);
      });
      expect(fitted).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(fitted).toEqual([
        [
          [2.17, 41.39],
          [2.17, 41.39],
        ],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the map where it is when the input is already in view", () => {
    vi.useFakeTimers();
    try {
      const layers = fakeLayers();
      const { map, fitted } = viewMap([4, 51, 6, 53]);
      render(<Harness map={map} sets={[{ role: "input", shapes: [drawn] }]} layers={layers} />);
      act(() => {
        vi.advanceTimersByTime(INPUT_SETTLE_MS);
      });
      expect(fitted).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves it to the result, once there is one", () => {
    vi.useFakeTimers();
    try {
      const layers = fakeLayers();
      const { map, fitted } = viewMap([4, 51, 6, 53]);
      render(
        <Harness
          map={map}
          sets={[
            { role: "input", shapes: [far] },
            { role: "result", shapes: [turned] },
          ]}
          layers={layers}
        />,
      );
      const once = fitted.length;
      act(() => {
        vi.advanceTimersByTime(INPUT_SETTLE_MS);
      });
      expect(fitted).toHaveLength(once);
    } finally {
      vi.useRealTimers();
    }
  });
});
