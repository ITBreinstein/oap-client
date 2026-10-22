/**
 * #4: a direct connection that failed the way a missing CORS header fails,
 * to an address the relay may read as a configured endpoint, offers "Try
 * through the relay". The button only connects to that endpoint: its own
 * question still has to be answered before anything goes through the relay.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EndpointScreen } from "../../src/app/EndpointScreen.js";
import type { EndpointRef, WorkflowError } from "../../src/app/workflow.js";
import type { RelayEndpoint } from "../../src/relay/contract.js";

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

const NOCORS = "http://localhost:5081";
const CORS_ERROR: WorkflowError = {
  title:
    "This page could not read this server: it sends no CORS headers, or it could not be reached.",
  corsOrUnreachable: true,
};
const READ_BY_RELAY: RelayEndpoint = {
  key: "pygeoapi-nocors-relay",
  baseUrl: NOCORS,
  executeRoute: "relay",
  readRoute: "relay",
  callbacks: false,
};
const NOT_READ_BY_RELAY: RelayEndpoint = {
  ...READ_BY_RELAY,
  key: "pygeoapi-nocors",
  readRoute: "direct",
};

function render(
  configured: readonly RelayEndpoint[],
  error: WorkflowError,
  failed: EndpointRef,
  onConnect = vi.fn(),
): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <EndpointScreen
        configured={configured}
        configuredError={undefined}
        presets={[]}
        connecting={undefined}
        error={error}
        failed={failed}
        staticOnly={false}
        onConnect={onConnect}
      />,
    );
  });
  return host;
}

const tryButton = (view: HTMLElement) =>
  [...view.querySelectorAll("button")].find((b) => b.textContent === "Try through the relay");

it("offers the relay's endpoint of the same address, and connects to it on a click", () => {
  const onConnect = vi.fn();
  const view = render(
    [NOT_READ_BY_RELAY, READ_BY_RELAY],
    CORS_ERROR,
    { source: "typed", baseUrl: `${NOCORS}/` },
    onConnect,
  );
  const button = tryButton(view);
  expect(button).toBeDefined();
  expect(onConnect).not.toHaveBeenCalled();
  act(() => {
    button?.click();
  });
  expect(onConnect).toHaveBeenCalledWith({ source: "configured", ...READ_BY_RELAY });
  // The error is put aside for the new attempt.
  expect(view.querySelector(".error-box")).toBeNull();
});

it("offers nothing when no configured endpoint of that address may be read by the relay", () => {
  const view = render([NOT_READ_BY_RELAY], CORS_ERROR, { source: "typed", baseUrl: NOCORS });
  expect(tryButton(view)).toBeUndefined();
});

it("offers nothing for another address", () => {
  const view = render([READ_BY_RELAY], CORS_ERROR, {
    source: "typed",
    baseUrl: "http://localhost:5099",
  });
  expect(tryButton(view)).toBeUndefined();
});

it("offers nothing for a failure that is not the CORS kind", () => {
  const view = render(
    [READ_BY_RELAY],
    { title: "Could not connect to this server." },
    {
      source: "typed",
      baseUrl: NOCORS,
    },
  );
  expect(tryButton(view)).toBeUndefined();
});

it("offers nothing when the endpoint that failed is the relay's own: its question was asked", () => {
  const view = render([READ_BY_RELAY], CORS_ERROR, { source: "configured", ...READ_BY_RELAY });
  expect(tryButton(view)).toBeUndefined();
});
