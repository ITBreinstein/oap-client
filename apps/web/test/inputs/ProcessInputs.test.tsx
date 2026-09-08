import { type ReactElement, StrictMode, act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ProcessInputs, defaultValues } from "../../src/inputs/ProcessInputs.js";
import {
  type CapturedProcessName,
  capturedProcessNames,
  readCapturedProcess,
} from "../captured-processes.js";

/** Renders a captured description with no values entered yet. */
function render(name: CapturedProcessName): HTMLElement {
  const process = readCapturedProcess(name);
  const host = document.createElement("div");
  document.body.append(host);

  act(() => {
    createRoot(host).render(
      <StrictMode>
        <ProcessInputs
          inputs={process.inputs}
          values={{}}
          onChange={() => {
            // The form is controlled by its parent; these tests only read markup.
          }}
        />
      </StrictMode>,
    );
  });

  return host;
}

/**
 * Renders the form wired to real state, the way `App` does, so a keystroke
 * round-trips through the parent and back into the control.
 */
function Harness({ name }: { name: CapturedProcessName }): ReactElement {
  const process = readCapturedProcess(name);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    defaultValues(process.inputs),
  );

  return (
    <>
      <ProcessInputs
        inputs={process.inputs}
        values={values}
        onChange={(id, value) => {
          setValues((previous) => ({ ...previous, [id]: value }));
        }}
      />
      <pre data-testid="values">{JSON.stringify(values)}</pre>
    </>
  );
}

function renderHarness(name: CapturedProcessName): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => {
    createRoot(host).render(<Harness name={name} />);
  });
  return host;
}

/**
 * Types into a controlled input the way a user would.
 *
 * React redefines `value` on the element itself, so assigning to it directly is
 * invisible to React and no change event follows. Taking the original setter
 * off the prototype and calling it with the element as receiver is the standard
 * way round that.
 */
function type(input: HTMLInputElement, text: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  act(() => {
    descriptor?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("against descriptions captured from ZOO-Project", () => {
  it.each(capturedProcessNames)("gives every %s input a labelled control", (name) => {
    const process = readCapturedProcess(name);
    const host = render(name);

    const ids = process.inputs.map((input) => input.id);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const control = host.querySelector(`[id="${id}"]`);
      expect(control, `no control rendered for ${id}`).not.toBeNull();
      expect(host.querySelector(`label[for="${id}"]`), `no label for ${id}`).not.toBeNull();
    }
  });

  it("renders a text box for a plain string input", () => {
    const control = render("Ogr2Ogr").querySelector('[id="F"]');
    expect(control?.tagName).toBe("INPUT");
    expect(control?.getAttribute("type")).toBe("text");
  });

  it("renders a numeric text box for a float input", () => {
    // Not `type="number"`: see NumberField. `format: float`, not
    // `type: integer`, so the keypad offers a decimal point.
    const control = render("Buffer").querySelector('[id="BufferDistance"]');
    expect(control?.tagName).toBe("INPUT");
    expect(control?.getAttribute("type")).toBe("text");
    expect(control?.getAttribute("inputmode")).toBe("decimal");
  });

  it("keeps a half-typed number on screen while treating it as absent", () => {
    // The bug this replaced: `-` was reported by the browser as an empty value,
    // the control fell back to the schema default, and the box snapped to 10.
    const host = renderHarness("Buffer");
    const box = host.querySelector<HTMLInputElement>('[id="BufferDistance"]');
    expect(box?.value).toBe("10");

    type(box as HTMLInputElement, "-");

    expect(box?.value).toBe("-");
    expect(host.querySelector('[data-testid="values"]')?.textContent).toBe("{}");
  });

  it("holds the number once it is complete", () => {
    const host = renderHarness("Buffer");
    const box = host.querySelector<HTMLInputElement>('[id="BufferDistance"]');

    type(box as HTMLInputElement, "-42.5");

    expect(box?.value).toBe("-42.5");
    expect(host.querySelector('[data-testid="values"]')?.textContent).toBe(
      '{"BufferDistance":-42.5}',
    );
  });

  it("lets an optional input be emptied rather than refilling it", () => {
    const host = renderHarness("Buffer");
    const box = host.querySelector<HTMLInputElement>('[id="BufferDistance"]');

    type(box as HTMLInputElement, "");

    expect(box?.value).toBe("");
    expect(host.querySelector('[data-testid="values"]')?.textContent).toBe("{}");
  });

  it("falls back to a JSON editor for a schema with no type", () => {
    // Buffer's polygon input is described only as a `oneOf`.
    expect(render("Buffer").querySelector('[id="InputPolygon"]')?.tagName).toBe("TEXTAREA");
  });

  it("falls back to a JSON editor for an object input", () => {
    // echo's `c` is `type: object`, `format: ogc-bbox` — really a bbox to draw.
    expect(render("echo").querySelector('[id="c"]')?.tagName).toBe("TEXTAREA");
  });

  it("seeds the values a control will display from the schema defaults", () => {
    // A control shows `schema.default`, so the form has to hold it: otherwise
    // the box reads 10 while the request omits the input entirely.
    expect(defaultValues(readCapturedProcess("Buffer").inputs)).toEqual({ BufferDistance: 10 });
    expect(defaultValues(readCapturedProcess("Ogr2Ogr").inputs)).toEqual({ F: "ESRI ShapeFile" });
  });

  it("seeds nothing when no input declares a default", () => {
    expect(defaultValues(readCapturedProcess("Centroid").inputs)).toEqual({});
  });

  // Known gap, and the dangerous kind: `maxOccurs: 1024` currently renders one
  // text box, so it looks correct while sending a single value where the server
  // accepts a list. Unlike the fallbacks above, nothing on screen says so.
  it.todo("renders a repeatable control when maxOccurs is above 1");
});
