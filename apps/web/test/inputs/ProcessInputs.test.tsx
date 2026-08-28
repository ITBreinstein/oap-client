import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ProcessInputs } from "../../src/inputs/ProcessInputs.js";
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

describe("against descriptions captured from ZOO-Project", () => {
  it.each(capturedProcessNames)("gives every %s input a labelled control", (name) => {
    const process = readCapturedProcess(name);
    const host = render(name);

    const ids = Object.keys(process.inputs);
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

  it("renders a number box for a float input", () => {
    const control = render("Buffer").querySelector('[id="BufferDistance"]');
    expect(control?.tagName).toBe("INPUT");
    expect(control?.getAttribute("type")).toBe("number");
    // `format: float`, not `type: integer`, so arbitrary decimals are allowed.
    expect(control?.getAttribute("step")).toBe("any");
  });

  it("falls back to a JSON editor for a schema with no type", () => {
    // Buffer's polygon input is described only as a `oneOf`.
    expect(render("Buffer").querySelector('[id="InputPolygon"]')?.tagName).toBe("TEXTAREA");
  });

  it("falls back to a JSON editor for an object input", () => {
    // echo's `c` is `type: object`, `format: ogc-bbox` — really a bbox to draw.
    expect(render("echo").querySelector('[id="c"]')?.tagName).toBe("TEXTAREA");
  });

  // Known gap, and the dangerous kind: `maxOccurs: 1024` currently renders one
  // text box, so it looks correct while sending a single value where the server
  // accepts a list. Unlike the fallbacks above, nothing on screen says so.
  it.todo("renders a repeatable control when maxOccurs is above 1");
});
