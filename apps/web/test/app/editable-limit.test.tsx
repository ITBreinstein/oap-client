/**
 * An input too large for the map to edit (`map.maxEditableCoordinates`):
 * "Draw on the map" is off for it and says why, drawing that was under way
 * stops, and the value is left as it is. The map pane's side — the value
 * kept out of Terra Draw and shown read-only — is driven in a real browser in
 * `e2e/workflow.spec.ts`.
 */

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DrawContext, type DrawTarget } from "../../src/app/draw.js";
import { FieldView } from "../../src/app/FormFields.js";
import { MapLimitsContext, tooManyToEdit } from "../../src/app/map-limits.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess } from "../forms/helpers.js";

const square = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [5.1, 52.1],
      [5.2, 52.1],
      [5.2, 52.2],
      [5.1, 52.2],
      [5.1, 52.1],
    ],
  ],
});

const [field] = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-rotate")).fields;

const seen: { value: unknown; stopped: number } = { value: undefined, stopped: 0 };

function Harness({ limit, drawing }: { readonly limit: number; readonly drawing: boolean }) {
  const [value, setValue] = useState<unknown>({ geojson: square });
  useEffect(() => {
    seen.value = value;
  }, [value]);
  if (field === undefined) throw new Error("no polygon field");
  const draw: DrawTarget = {
    fieldId: drawing ? field.id : undefined,
    available: true,
    start: () => undefined,
    stop: () => {
      seen.stopped += 1;
    },
  };
  return (
    <MapLimitsContext value={{ maxCoordinates: 250_000, maxEditableCoordinates: limit }}>
      <DrawContext value={draw}>
        <FieldView
          field={field}
          index={0}
          values={{ [field.id]: value }}
          error={undefined}
          onChange={(_id, next) => {
            setValue(next);
          }}
        />
      </DrawContext>
    </MapLimitsContext>
  );
}

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  seen.value = undefined;
  seen.stopped = 0;
});

function render(limit: number, drawing = false): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(<Harness limit={limit} drawing={drawing} />);
  });
  return host;
}

function drawButton(view: HTMLElement): HTMLButtonElement | undefined {
  return [...view.querySelectorAll("button")].find((button) =>
    /Draw on the map|Stop drawing/.test(button.textContent),
  );
}

describe("tooManyToEdit", () => {
  it("counts every position, and is undefined at or under the limit", () => {
    expect(tooManyToEdit(square, 5)).toBeUndefined();
    expect(tooManyToEdit(square, 4)).toEqual({ positions: 5, limit: 4 });
    expect(tooManyToEdit("", 1)).toBeUndefined();
    expect(tooManyToEdit('{"type": "Poly', 1)).toBeUndefined();
  });
});

describe("a GeoJSON field over the editable limit", () => {
  it("turns Draw on the map off, says why, and leaves the value as it is", () => {
    const view = render(4);
    const button = drawButton(view);
    expect(button?.disabled).toBe(true);
    const message = view.querySelector("[data-testid='too-many-to-edit']");
    expect(message?.textContent).toContain(
      "This input has 5 coordinates, more than the 4 the map edits at once",
    );
    expect(button?.getAttribute("aria-describedby")).toBe(message?.id);
    expect(seen.value).toEqual({ geojson: square });
  });

  it("stops drawing that was under way", () => {
    render(4, true);
    expect(seen.stopped).toBe(1);
    expect(seen.value).toEqual({ geojson: square });
  });

  it("offers drawing as before at or under the limit", () => {
    const view = render(5);
    expect(drawButton(view)?.disabled).toBe(false);
    expect(view.querySelector("[data-testid='too-many-to-edit']")).toBeNull();
    render(5, true);
    expect(seen.stopped).toBe(0);
  });
});
