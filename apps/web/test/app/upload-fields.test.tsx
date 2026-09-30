/**
 * Loading a file into a GeoJSON or complex input (package 3): an oversized
 * file is refused unread, a file that is not JSON leaves the value as it was,
 * and a good one becomes the value.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplexField } from "../../src/app/ComplexField.js";
import { GeometryField } from "../../src/app/GeometryField.js";
import type { ComplexControl, GeometryControl } from "../../src/forms/plan.js";
import { MAX_UPLOAD_BYTES } from "../../src/forms/upload.js";

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

/** Pick `file` in the only file input under `container`. */
async function pick(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // FileReader and Blob.text() settle on later turns.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function oversized(): { file: File; read: ReturnType<typeof vi.fn> } {
  const file = new File(["{}"], "huge.geojson");
  Object.defineProperty(file, "size", { value: MAX_UPLOAD_BYTES + 1 });
  const read = vi.fn();
  Object.defineProperty(file, "text", { value: read });
  Object.defineProperty(file, "arrayBuffer", { value: read });
  Object.defineProperty(file, "stream", { value: read });
  return { file, read };
}

const status = (container: HTMLElement) => container.querySelector('[role="status"]')?.textContent;

const polygon: GeometryControl = {
  kind: "geometry",
  wrapper: "geometry",
  geometryTypes: ["Polygon"],
};
const PREVIOUS = { geojson: '{"type":"Polygon","coordinates":[[[4,52],[5,52],[5,53],[4,52]]]}' };

function geometryField(onChange: (value: unknown) => void) {
  return render(
    <GeometryField
      id="f"
      control={polygon}
      value={PREVIOUS}
      required
      describedBy={undefined}
      label="Area"
      onChange={onChange}
    />,
  );
}

describe("loading a file into a GeoJSON input", () => {
  it("refuses a file over the limit without reading it", async () => {
    const onChange = vi.fn();
    const container = geometryField(onChange);
    const { file, read } = oversized();
    await pick(container, file);
    expect(read).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(status(container)).toMatch(
      /This page reads files up to 10\.0 MB, so it was not opened\./,
    );
  });

  it("keeps the previous value when the file is not JSON", async () => {
    const onChange = vi.fn();
    const container = geometryField(onChange);
    await pick(container, new File(["not json"], "broken.geojson"));
    expect(onChange).not.toHaveBeenCalled();
    expect(status(container)).toBe("That file is not valid JSON.");
  });

  it("makes a good file the value", async () => {
    const onChange = vi.fn();
    const container = geometryField(onChange);
    const square = {
      type: "Polygon",
      coordinates: [
        [
          [5.1, 52.1],
          [5.2, 52.1],
          [5.2, 52.2],
          [5.1, 52.1],
        ],
      ],
    };
    await pick(container, new File([JSON.stringify(square)], "square.geojson"));
    expect(onChange).toHaveBeenCalledWith({ geojson: JSON.stringify(square) });
  });
});

const objectOrGml: ComplexControl = {
  kind: "complex",
  formats: [
    { label: "JSON object", object: true },
    { label: "GML", mediaType: "application/gml+xml", object: false },
  ],
  byReference: false,
};

function complexField(format: number, onChange: (value: unknown) => void) {
  return render(
    <ComplexField
      id="f"
      control={objectOrGml}
      value={{ format, value: '{"kept":true}' }}
      required
      describedBy={undefined}
      label="Shape"
      onChange={onChange}
    />,
  );
}

describe("loading a file into a complex input", () => {
  it("refuses a file over the limit without reading it", async () => {
    const onChange = vi.fn();
    const container = complexField(1, onChange);
    const { file, read } = oversized();
    await pick(container, file);
    expect(read).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(status(container)).toMatch(/so it was not opened\.$/);
  });

  it("keeps the previous value when a JSON-object format is given a file that is not JSON", async () => {
    const onChange = vi.fn();
    const container = complexField(0, onChange);
    await pick(container, new File(["<gml:Polygon/>"], "shape.gml"));
    expect(onChange).not.toHaveBeenCalled();
    expect(status(container)).toBe("That file is not valid JSON, so the value was not changed.");
  });

  it("makes a JSON object file the value", async () => {
    const onChange = vi.fn();
    const container = complexField(0, onChange);
    await pick(container, new File(['{"type":"FeatureCollection","features":[]}'], "fc.json"));
    expect(onChange).toHaveBeenCalledWith({
      format: 0,
      value: '{"type":"FeatureCollection","features":[]}',
    });
    expect(status(container)).toBeUndefined();
  });

  it("reads a text format as text, JSON or not", async () => {
    const onChange = vi.fn();
    const container = complexField(1, onChange);
    await pick(container, new File(["<gml:Polygon/>"], "shape.gml"));
    expect(onChange).toHaveBeenCalledWith({ format: 1, value: "<gml:Polygon/>" });
  });
});
