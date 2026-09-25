/**
 * Shown shapes with the layers stubbed: what they are handed, when the map
 * moves, and when the count of result shapes can be trusted.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { MapShape } from "../../src/map/geometry-engine.js";
import type {
  CreateShapeLayers,
  ShapeLayers,
  ShownImage,
  ShownShapes,
} from "../../src/map/shape-layers.js";
import { useShownShapes } from "../../src/map/useShownShapes.js";

interface FakeLayers extends ShapeLayers {
  readonly shown: (readonly ShownShapes[])[];
  readonly images: (ShownImage | undefined)[];
  readonly create: CreateShapeLayers;
  stopped: boolean;
  becomeReady(): void;
}

function fakeLayers(): FakeLayers {
  let ready: (() => void) | undefined;
  const layers: FakeLayers = {
    shown: [],
    images: [],
    stopped: false,
    create: () => layers,
    show: (sets) => layers.shown.push(sets),
    showImage: (image) => layers.images.push(image),
    onReady: (listener) => {
      ready = listener;
    },
    stop: () => {
      layers.stopped = true;
    },
    becomeReady: () => ready?.(),
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
}) {
  const { resultShapes, resultImage } = useShownShapes(
    props.map as never,
    props.sets,
    props.image,
    props.layers.create,
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
