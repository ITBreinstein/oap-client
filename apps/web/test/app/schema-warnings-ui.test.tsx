/**
 * Schema warnings on screen (package 6): under the field, linked to it, said
 * as information, and stepping aside for an error, which says more.
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

const [field] = planFor({ label: { schema: { type: "string", pattern: "^[A-Z]+$" } } }).fields;

function view(error: string | undefined, warnings: readonly string[] | undefined): HTMLElement {
  if (field === undefined) throw new Error("no field");
  return render(
    <FieldView
      field={field}
      index={0}
      values={{ label: "abc" }}
      error={error}
      warnings={warnings}
      onChange={vi.fn()}
    />,
  );
}

describe("schema warnings beside a field", () => {
  it("lists them under the field, linked to its input, saying the value is sent anyway", () => {
    const page = view(undefined, ["The value should match the pattern ^[A-Z]+$."]);
    const box = page.querySelector("[data-schema-warnings]");
    expect(box?.textContent).toContain("It will still be sent as it is");
    expect(box?.querySelector("li")?.textContent).toBe(
      "The value should match the pattern ^[A-Z]+$.",
    );
    expect(page.querySelector("input")?.getAttribute("aria-describedby")).toContain(box?.id);
    expect(box?.closest("[role='alert'], .field-error")).toBeNull();
  });

  it("shows only the error when there is one", () => {
    const page = view("Enter a label.", ["The value should match the pattern ^[A-Z]+$."]);
    expect(page.querySelector("[data-schema-warnings]")).toBeNull();
    expect(page.querySelector(".field-error")?.textContent).toBe("Enter a label.");
  });
});
