/**
 * What a screen reader is told about a field in error: the control says it
 * is invalid and is described by its message; a group (a list, an area, a
 * file) is described on its fieldset, which is read on entering it.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldView } from "../../src/app/FormFields.js";
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

function view(schema: object, error: string | undefined): HTMLElement {
  const plan = planFor({ input: { schema } });
  const [only] = plan.fields;
  if (only === undefined) throw new Error("no field");
  return render(<FieldView field={only} index={0} values={{}} error={error} onChange={vi.fn()} />);
}

describe("a field in error", () => {
  it("marks a single control invalid and describes it by its message", () => {
    const container = view({ type: "string" }, "Required. Fill this in before running.");
    const input = container.querySelector("input");
    const message = container.querySelector(".field-error");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toContain(message?.id ?? "missing");
  });

  it("says nothing of the kind when the field is fine", () => {
    const input = view({ type: "string" }, undefined).querySelector("input");
    expect(input?.hasAttribute("aria-invalid")).toBe(false);
  });

  it("describes a group on its fieldset, where it is read", () => {
    const container = view({ type: "array", items: { type: "string" } }, "Give at least one.");
    const fieldset = container.querySelector("fieldset");
    const message = container.querySelector(".field-error");
    expect(fieldset?.getAttribute("aria-describedby")).toContain(message?.id ?? "missing");
    expect(container.querySelector(".list")?.hasAttribute("aria-describedby")).toBe(false);
  });
});
