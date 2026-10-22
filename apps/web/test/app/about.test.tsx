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

  it("says who made it, and names the npm package under this version, linked", () => {
    const container = render(<AboutPanel />);
    expect(container.textContent).toContain("Made by Munib Özdemir.");
    const version = container.querySelector('[aria-labelledby="about-version"]');
    const npm = [...(version?.querySelectorAll("a") ?? [])].find(
      (a) => a.textContent === "@breinstein/oap-client",
    );
    expect(npm?.getAttribute("href")).toBe("https://www.npmjs.com/package/@breinstein/oap-client");
  });

  it("says when the relay is used, and that a typed address never is (#44)", () => {
    const container = render(<AboutPanel />);
    const text = container.textContent.replace(/\s+/g, " ");
    expect(text).toContain(
      "Requests go straight to the service. For some listed services, background runs go through Breinstein’s relay so this page can follow them. If a listed service can’t be read directly, the page asks before using the relay. An address you type is always reached directly.",
    );
    expect(text).not.toContain("no CORS");
    // The log sentences stay as they were.
    expect(text).toContain(
      "The relay keeps a short log of each request: the service, the path, the status, the size and the time. Never your IP address or what you sent.",
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
