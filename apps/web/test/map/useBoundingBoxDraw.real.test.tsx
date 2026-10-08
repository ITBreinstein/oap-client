/**
 * The bounding-box hook on the real engine and the real Terra Draw (see
 * `real-terra-draw.ts`): a box typed, or cleared, while the drawn one is
 * selected is what the field keeps (review W15). Before the engine ran its own
 * changes through one guard, showing the typed box deselected the old one,
 * Terra Draw reported that as an update, and the hook handed the old box back
 * to the field as though the user had drawn it.
 */

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bbox } from "../../src/map/bbox.js";
import { drawnShapes, fakeMap, lastDraw, resetTerraDraw, user } from "./real-terra-draw.js";

vi.mock("terra-draw", async (original) =>
  (await import("./real-terra-draw.js")).spyOnTerraDraw(await original()),
);
vi.mock("terra-draw-maplibre-gl-adapter", async (original) =>
  (await import("./real-terra-draw.js")).spyOnAdapter(await original()),
);

const { useBoundingBoxDraw } = await import("../../src/map/useBoundingBoxDraw.js");

/** The field, as the test sees it: its value, and a way to type into it. */
const field: { value?: Bbox | undefined; type?: (bbox: Bbox | undefined) => void } = {};

function Field({ map }: { readonly map: never }) {
  const [value, setValue] = useState<Bbox | undefined>(undefined);
  useEffect(() => {
    field.value = value;
    field.type = setValue;
  }, [value]);
  useBoundingBoxDraw(map, { active: true, value, onChange: setValue });
  return null;
}

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  resetTerraDraw();
});

function drawAndSelectBox(): void {
  root = createRoot(document.createElement("div"));
  act(() => {
    root?.render(<Field map={fakeMap().map} />);
  });
  act(() => {
    user.click(5.0, 52.0);
    user.click(5.2, 52.2);
  });
  expect(field.value).toEqual([5, 52, 5.2, 52.2]);
  // The user clicks the box, to move or resize it next.
  const draw = lastDraw();
  const [box] = drawnShapes(draw);
  act(() => {
    draw.selectFeature(box?.id ?? "");
  });
  expect(draw.getMode()).toBe("select");
}

describe("typing a box while the drawn one is selected (W15)", () => {
  it("keeps the typed box", () => {
    drawAndSelectBox();
    act(() => {
      field.type?.([4, 51, 4.5, 51.5]);
    });
    expect(field.value).toEqual([4, 51, 4.5, 51.5]);
  });

  it("keeps a Clear", () => {
    drawAndSelectBox();
    act(() => {
      field.type?.(undefined);
    });
    expect(field.value).toBeUndefined();
  });
});

describe("a draw mode asked for before the map's style is in (W30)", () => {
  it("starts once the style has loaded, and draws", () => {
    const map = fakeMap({ styleLoaded: false });
    root = createRoot(document.createElement("div"));
    act(() => {
      root?.render(<Field map={map.map} />);
    });
    // Terra Draw would have thrown "Style is not done loading" on its first source.
    expect(map.sources.size).toBe(0);

    act(() => {
      map.loadStyle();
    });
    expect(map.sources.size).toBeGreaterThan(0);
    act(() => {
      user.click(5.0, 52.0);
      user.click(5.2, 52.2);
    });
    expect(field.value).toEqual([5, 52, 5.2, 52.2]);
  });
});
