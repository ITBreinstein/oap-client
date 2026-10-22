/**
 * #1: one error at a time on the start screen, under the field it is about.
 * A connection error is put aside once the address changes, another service
 * is chosen, or Connect is pressed again; a new one shows.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EndpointScreen, type EndpointScreenProps } from "../../src/app/EndpointScreen.js";
import { UpdatedContext } from "../../src/app/variant.js";
import type { WorkflowError } from "../../src/app/workflow.js";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

const CORS: WorkflowError = {
  title:
    "This page could not read this server: it sends no CORS headers, or it could not be reached.",
  detail: "A browser gives a web page the same error for both.",
};

function screen(error: WorkflowError | undefined, updated: boolean) {
  const props: EndpointScreenProps = {
    configured: [],
    configuredError: undefined,
    presets: [{ title: "pygeoapi, without CORS (local)", url: "http://localhost:5081" }],
    connecting: undefined,
    error,
    staticOnly: false,
    onConnect: () => undefined,
  };
  return (
    <UpdatedContext value={updated}>
      <EndpointScreen {...props} />
    </UpdatedContext>
  );
}

function render(error: WorkflowError | undefined, updated: boolean): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(screen(error, updated));
  });
  return host;
}

function type(view: HTMLElement, text: string) {
  const input = view.querySelector<HTMLInputElement>("input[type='url']");
  if (input === null) throw new Error("no address field");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(view: HTMLElement, name: string) {
  const button = [...view.querySelectorAll("button")].find((b) => b.textContent === name);
  act(() => {
    button?.click();
  });
}

const alerts = (view: HTMLElement) =>
  [...view.querySelectorAll("[role='alert']")].map((alert) => alert.textContent);

for (const updated of [false, true]) {
  describe(`the start screen's errors (${updated ? "updated" : "Instrument"})`, () => {
    it("shows a connection error under the address field, as an alert", () => {
      const view = render(CORS, updated);
      const box = view.querySelector(".address-field .error-box");
      expect(box?.getAttribute("role")).toBe("alert");
      expect(box?.textContent).toContain("could not read this server");
      // Before the list of services, not after it.
      const list = view.querySelector(".service-choices");
      expect(
        list === null ||
          (box?.compareDocumentPosition(list) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("never shows the old connection error beside a new field error", () => {
      const view = render(CORS, updated);
      type(view, "example.org");
      press(view, "Connect");
      expect(alerts(view)).toEqual([
        "Enter the full address of a service, starting with http:// or https://.",
      ]);
    });

    it("puts the error aside as soon as the address changes", () => {
      const view = render(CORS, updated);
      type(view, "h");
      expect(view.querySelector(".error-box")).toBeNull();
    });

    it("puts the error aside when another service is chosen", () => {
      const view = render(CORS, updated);
      // Not the one already chosen: Instrument picks the first for the user.
      const radio = [...view.querySelectorAll<HTMLInputElement>("input[type='radio']")].find(
        (input) => !input.checked,
      );
      act(() => {
        radio?.click();
      });
      expect(view.querySelector(".error-box")).toBeNull();
    });

    it("shows the next connection error", () => {
      const view = render(CORS, updated);
      type(view, "h");
      expect(view.querySelector(".error-box")).toBeNull();
      act(() => {
        root?.render(screen({ ...CORS }, updated));
      });
      expect(view.querySelector(".error-box")?.textContent).toContain("could not read this server");
    });
  });
}
