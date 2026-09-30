/**
 * The bounding-box field as a user drives it: typed numbers and a chosen CRS
 * reach the value in whichever order they are given, switching between two
 * and three dimensions keeps each number in its place, drawing never relabels
 * typed numbers, and leaving the JSON editor starts from empty fields.
 */

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DrawContext, type DrawTarget } from "../../src/app/draw.js";
import { FieldView } from "../../src/app/FormFields.js";
import { CRS84, CRS84H } from "../../src/forms/crs.js";
import { toExecuteBody } from "../../src/forms/encode.js";
import type { FormPlan } from "../../src/forms/plan.js";
import { validateForm } from "../../src/forms/validate.js";
import { planFor } from "../forms/helpers.js";

const EPSG_4326 = "http://www.opengis.net/def/crs/EPSG/0/4326";
const EPSG_3857 = "http://www.opengis.net/def/crs/EPSG/0/3857";
const EPSG_28992 = "http://www.opengis.net/def/crs/EPSG/0/28992";

/** A box input offering exactly these CRSs, the first as the default. */
function boxOffering(crs: readonly string[], dimensions: readonly (4 | 6)[] = [4]): FormPlan {
  const [min, max] = [Math.min(...dimensions), Math.max(...dimensions)];
  return planFor({
    box: {
      schema: {
        type: "object",
        required: ["bbox"],
        properties: {
          bbox: { type: "array", items: { type: "number" }, minItems: min, maxItems: max },
          crs: { type: "string", enum: [...crs], default: crs[0] },
        },
      },
    },
  });
}

/** The standard's own bbox schema: CRS84 and CRS84h, four or six numbers. */
const STANDARD = planFor({
  box: {
    schema: {
      allOf: [
        { format: "ogc-bbox" },
        {
          $ref: "https://schemas.opengis.net/ogcapi/processes/part1/1.0/openapi/schemas/bbox.yaml",
        },
      ],
    },
  },
});

const seen: { value: unknown } = { value: undefined };
const drawing: { started: string[]; stopped: number } = { started: [], stopped: 0 };

function Harness({ plan, draw }: { readonly plan: FormPlan; readonly draw: boolean }) {
  const [value, setValue] = useState<unknown>(undefined);
  const [fieldId, setFieldId] = useState<string | undefined>(undefined);
  useEffect(() => {
    seen.value = value;
  });
  const [field] = plan.fields;
  if (field === undefined) throw new Error("no field");
  const target: DrawTarget = {
    fieldId,
    available: draw,
    start: (id) => {
      drawing.started.push(id);
      setFieldId(id);
    },
    stop: () => {
      drawing.stopped += 1;
      setFieldId(undefined);
    },
  };
  return (
    <DrawContext value={target}>
      <FieldView
        field={field}
        index={0}
        values={{ box: value }}
        error={undefined}
        onChange={(_id, next) => {
          setValue(next);
        }}
      />
    </DrawContext>
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
  drawing.started = [];
  drawing.stopped = 0;
});

function mount(plan: FormPlan, draw = false): HTMLElement {
  const element = document.createElement("div");
  host = element;
  document.body.append(element);
  const created = createRoot(element);
  root = created;
  act(() => {
    created.render(<Harness plan={plan} draw={draw} />);
  });
  return element;
}

function inputs(page: HTMLElement): HTMLInputElement[] {
  return [...page.querySelectorAll<HTMLInputElement>(".coordinates input")];
}

function typeAll(page: HTMLElement, texts: readonly string[]) {
  texts.forEach((text, index) => {
    const input = inputs(page)[index];
    if (input === undefined) throw new Error(`no coordinate input ${String(index)}`);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

function choose(page: HTMLElement, crs: string) {
  const select = page.querySelector("select");
  if (select === null) throw new Error("no CRS select");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, crs);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(page: HTMLElement, name: string) {
  const button = [...page.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  );
  if (button === undefined) throw new Error(`no button "${name}"`);
  act(() => {
    button.click();
  });
}

describe("a CRS and numbers, in either order (W2)", () => {
  it("keeps a CRS chosen before any number is typed, and sends the numbers in it", () => {
    const plan = boxOffering([EPSG_4326, EPSG_3857]);
    const page = mount(plan);
    choose(page, EPSG_3857);
    expect(page.querySelector("select")?.value).toBe(EPSG_3857);
    expect(seen.value).toEqual({ coordinates: [], crs: EPSG_3857 });

    typeAll(page, ["470000", "6800000", "480000", "6810000"]);
    expect(seen.value).toEqual({ coordinates: [470000, 6800000, 480000, 6810000], crs: EPSG_3857 });
    expect(toExecuteBody(plan, { box: seen.value }).inputs["box"]).toEqual({
      bbox: [470000, 6800000, 480000, 6810000],
      crs: EPSG_3857,
    });
  });

  it("labels numbers typed first with the CRS chosen after them", () => {
    const plan = boxOffering([EPSG_4326, EPSG_3857]);
    const page = mount(plan);
    typeAll(page, ["470000", "6800000", "480000", "6810000"]);
    choose(page, EPSG_3857);
    expect(seen.value).toEqual({ coordinates: [470000, 6800000, 480000, 6810000], crs: EPSG_3857 });
  });

  it("does not send an empty box that has a CRS, and still asks for it when required", () => {
    const plan = boxOffering([EPSG_4326, EPSG_3857]);
    const value = { coordinates: [], crs: EPSG_3857 };
    expect(toExecuteBody(plan, { box: value }).inputs).toEqual({});
    expect(validateForm(plan, { box: value }).has("box")).toBe(true);
  });
});

describe("two and three dimensions (W20)", () => {
  it("offers the standard's CRS84 and CRS84h", () => {
    expect(STANDARD.fields[0]?.control).toMatchObject({
      kind: "bbox",
      crs: [CRS84, CRS84H],
      dimensions: [4, 6],
    });
  });

  it("chosen first, takes six numbers", () => {
    const page = mount(STANDARD);
    choose(page, CRS84H);
    expect(page.querySelector("select")?.value).toBe(CRS84H);
    expect(inputs(page)).toHaveLength(6);
    typeAll(page, ["4.1", "52.1", "0", "4.2", "52.2", "30"]);
    expect(seen.value).toEqual({ coordinates: [4.1, 52.1, 0, 4.2, 52.2, 30], crs: CRS84H });
  });

  it("chosen after four numbers, keeps each number in its place and adds empty heights", () => {
    const page = mount(STANDARD);
    typeAll(page, ["4.1", "52.1", "4.2", "52.2"]);
    choose(page, CRS84H);
    expect(inputs(page).map((input) => input.value)).toEqual([
      "4.1",
      "52.1",
      "",
      "4.2",
      "52.2",
      "",
    ]);
    typeAll(page, ["4.1", "52.1", "0", "4.2", "52.2", "30"]);
    expect(seen.value).toEqual({ coordinates: [4.1, 52.1, 0, 4.2, 52.2, 30], crs: CRS84H });

    choose(page, CRS84);
    expect(inputs(page).map((input) => input.value)).toEqual(["4.1", "52.1", "4.2", "52.2"]);
    expect(seen.value).toEqual({ coordinates: [4.1, 52.1, 4.2, 52.2], crs: CRS84 });
  });

  it("refuses a count that does not match the CRS", () => {
    const six = [4.1, 52.1, 0, 4.2, 52.2, 30];
    const four = [4.1, 52.1, 4.2, 52.2];
    const refused = (coordinates: number[], crs: string) =>
      validateForm(STANDARD, { box: { coordinates, crs } }).has("box");
    expect(refused(six, CRS84)).toBe(true);
    expect(refused(four, CRS84H)).toBe(true);
    expect(refused(six, CRS84H)).toBe(false);
    expect(refused(four, CRS84)).toBe(false);
  });
});

describe("drawing from a projected CRS (W21)", () => {
  it("clears the typed numbers rather than relabel them, keeps the CRS, and says so", () => {
    const plan = boxOffering([EPSG_28992, CRS84]);
    const page = mount(plan, true);
    // A typed box starts in CRS84 where it is offered: RD New is a choice.
    choose(page, EPSG_28992);
    typeAll(page, ["120000", "480000", "125000", "485000"]);
    expect(seen.value).toEqual({ coordinates: [120000, 480000, 125000, 485000], crs: EPSG_28992 });

    click(page, "Draw on the map");
    expect(drawing.started).toEqual(["box"]);
    expect(inputs(page).map((input) => input.value)).toEqual(["", "", "", ""]);
    expect(seen.value).toEqual({ coordinates: [], crs: EPSG_28992 });
    expect(page.querySelector("[role='status']")?.textContent).toContain(
      `The numbers typed in ${EPSG_28992} were cleared`,
    );
  });

  it("says nothing when there was nothing to clear", () => {
    const plan = boxOffering([EPSG_28992, CRS84]);
    const page = mount(plan, true);
    click(page, "Draw on the map");
    expect(drawing.started).toEqual(["box"]);
    expect(page.querySelector("[role='status']")).toBeNull();
  });
});

describe("leaving the JSON editor (W32)", () => {
  it("starts from empty coordinate fields, as the value does", () => {
    const plan = boxOffering([EPSG_28992]);
    const page = mount(plan);
    typeAll(page, ["120000", "480000", "125000", "485000"]);
    click(page, "Enter as JSON");
    expect(seen.value).toEqual({ rawJson: "" });
    click(page, "Use coordinate fields");
    expect(seen.value).toBeUndefined();
    expect(inputs(page).map((input) => input.value)).toEqual(["", "", "", ""]);
  });
});
