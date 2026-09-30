/**
 * The raw JSON editor sends what is typed. For a bare object it says, next to
 * the field, what version 1.0 expects — and blocks nothing.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldView } from "../../src/app/FormFields.js";
import { validateForm } from "../../src/forms/validate.js";
import { planFor } from "../forms/helpers.js";

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
});

// A `oneOf` of plain types is not the complex-input pattern: a raw JSON editor.
const plan = planFor({ settings: { schema: { oneOf: [{ type: "string" }, { type: "number" }] } } });

function field(rawJson: string): HTMLElement {
  const [only] = plan.fields;
  if (only === undefined) throw new Error("no field");
  return render(
    <FieldView
      field={only}
      index={0}
      values={{ settings: { rawJson } }}
      error={undefined}
      onChange={vi.fn()}
    />,
  );
}

describe("the raw JSON editor's hint", () => {
  it("explains the wrapping for a bare object, linked to the field, and does not block a run", () => {
    expect(plan.fields[0]?.control.kind).toBe("json");
    const view = field('{"k": 1}');
    const hint = view.querySelector("[data-bare-object-hint]");
    expect(hint?.textContent).toContain('expects an object input wrapped as { "value": … }');
    const textarea = view.querySelector("textarea");
    expect(textarea?.getAttribute("aria-describedby")).toContain(hint?.id ?? "missing");
    expect(validateForm(plan, { settings: { rawJson: '{"k": 1}' } }).size).toBe(0);
  });

  it("says nothing for a qualified value", () => {
    const view = field('{"value": {"k": 1}}');
    expect(view.querySelector("[data-bare-object-hint]")).toBeNull();
  });
});
