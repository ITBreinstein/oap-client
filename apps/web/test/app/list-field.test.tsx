/**
 * A repeatable input's rows as a user sees them: each row is as required as
 * the list (W18), so what a row shows is what the request carries.
 */

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FieldView } from "../../src/app/FormFields.js";
import { initialValues } from "../../src/forms/defaults.js";
import { toExecuteBody, type FormValues } from "../../src/forms/encode.js";
import type { FormPlan } from "../../src/forms/plan.js";
import { planFor } from "../forms/helpers.js";

let root: Root | undefined;
let host: HTMLElement | undefined;
const seen: { values: FormValues } = { values: {} };

function Harness({ plan }: { readonly plan: FormPlan }) {
  const [values, setValues] = useState<FormValues>(() => initialValues(plan));
  useEffect(() => {
    seen.values = values;
  }, [values]);
  const [field] = plan.fields;
  if (field === undefined) throw new Error("no field");
  return (
    <FieldView
      field={field}
      index={0}
      values={values}
      error={undefined}
      onChange={(id, value) => {
        setValues((current) => ({ ...current, [id]: value }));
      }}
    />
  );
}

function render(plan: FormPlan): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(<Harness plan={plan} />);
  });
  return host;
}

function addValue(view: HTMLElement) {
  const add = [...view.querySelectorAll("button")].find((b) => b.textContent === "Add a value");
  act(() => {
    add?.click();
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("a list of booleans", () => {
  it("offers 'Not set' on an optional list's row, chosen, and sends nothing", () => {
    const plan = planFor({ flags: { schema: { type: "boolean" }, minOccurs: 0, maxOccurs: 5 } });
    const view = render(plan);

    const choices = [...view.querySelectorAll<HTMLInputElement>('li input[type="radio"]')];
    expect(choices.map((choice) => choice.parentElement?.textContent.trim())).toEqual([
      "Not set",
      "Yes",
      "No",
    ]);
    expect(choices[0]?.checked).toBe(true);
    expect(view.querySelector('li input[type="checkbox"]')).toBeNull();
    expect(toExecuteBody(plan, seen.values).inputs).toEqual({});
  });

  it("adds a row to a required list that shows the false it will send", () => {
    const plan = planFor({ flags: { schema: { type: "boolean" }, minOccurs: 1, maxOccurs: 5 } });
    const view = render(plan);
    addValue(view);

    const boxes = [...view.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]')];
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
    expect(toExecuteBody(plan, seen.values).inputs).toEqual({ flags: [false, false] });
  });
});

describe("a list of choices", () => {
  it("says 'Not set' on an optional list's row, and adds rows that are not set", () => {
    const plan = planFor({
      layers: {
        schema: { type: "string", enum: ["roads", "water"], default: "roads" },
        minOccurs: 0,
        maxOccurs: 3,
      },
    });
    const view = render(plan);
    addValue(view);

    const selects = [...view.querySelectorAll<HTMLSelectElement>("li select")];
    expect(selects.map((select) => select.selectedOptions[0]?.textContent)).toEqual([
      "Not set",
      "Not set",
    ]);
    expect(toExecuteBody(plan, seen.values).inputs).toEqual({});
  });
});
