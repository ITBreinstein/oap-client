/**
 * The Developer section's job panel: a job's status URL comes from the
 * server, so it becomes a link only when it is http(s).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StatusLink } from "../../src/jobs/AsyncJobPanel.js";

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

describe("StatusLink", () => {
  it("links an http(s) status URL", () => {
    const view = render(<StatusLink url="https://ogc.example.org/jobs/1" label="1" />);
    expect(view.querySelector("a")?.getAttribute("href")).toBe("https://ogc.example.org/jobs/1");
    expect(view.textContent).toBe("1");
  });

  it.each(["javascript:alert(1)", "data:text/html,<p>x</p>", "jobs/1"])(
    "shows %s as text, never as a link",
    (url) => {
      const view = render(<StatusLink url={url} label={url} />);
      expect(view.querySelector("a")).toBeNull();
      expect(view.textContent).toBe(url);
    },
  );
});
