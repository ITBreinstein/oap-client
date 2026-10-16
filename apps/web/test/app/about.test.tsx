/**
 * The About panel's content: the version line, both versions in it, the
 * logo named for a screen reader, and no placeholder from the designs.
 */

import { VERSION } from "@breinstein/oap-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AboutFooter, AboutPanel, versionLine } from "../../src/app/AboutPanel.js";
import packageJson from "../../package.json?raw";

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

const appVersion = (JSON.parse(packageJson) as { version: string }).version;

describe("About", () => {
  it("says the app's version, then the core's", () => {
    expect(versionLine("0.5.0", "0.6.1")).toBe("0.5.0 · core 0.6.1");
  });

  it("shows this build's version, read from package.json at build time, beside the core's", () => {
    const container = render(<AboutPanel />);
    expect(container.querySelector('[data-testid="app-version"]')?.textContent).toBe(
      `${appVersion} · core ${VERSION}`,
    );
  });

  it("names the logo, and links the standard and the source", () => {
    const container = render(<AboutPanel />);
    expect(container.querySelector('svg[role="img"] title')?.textContent).toBe(
      "Breinstein, digital natives rule",
    );
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("https://docs.ogc.org/is/18-062r2/18-062r2.html");
    expect(links).toContain("https://github.com/ITBreinstein/oap-client");
  });

  it("carries no placeholder from the designs", () => {
    const container = render(
      <>
        <AboutPanel />
        <AboutFooter />
      </>,
    );
    expect(container.textContent).not.toMatch(/[[\]]/);
  });
});
