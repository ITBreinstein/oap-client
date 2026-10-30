/**
 * A configured endpoint that names its processes: the list shows only those,
 * in the server's order, and says what it left out — without ever leaving
 * nothing to open, and without a second count that disagrees with the first.
 */

import {
  unknownCapabilities,
  type ProcessList,
  type ProcessSummary,
  type ServiceDescription,
} from "@breinstein/oap-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { listedProcesses, narrowedCount, unappliedNote } from "../../src/app/listed-processes.js";
import { ProcessListScreen } from "../../src/app/ProcessListScreen.js";
import { relayEndpointFor } from "../../src/app/run.js";
import type { EndpointRef } from "../../src/app/workflow.js";
import { fixtureProcess } from "../forms/helpers.js";

const inputsProcess = fixtureProcess("pygeoapi/breinstein-inputs");
const summary = (id: string): ProcessSummary => ({ ...inputsProcess, id, title: id });

const list: ProcessList = {
  processes: [summary("Buffer"), summary("SAGA.x"), summary("hellojs"), summary("OTB.y")],
  links: [],
  pageCount: 1,
  truncated: false,
};

const zoo: EndpointRef = {
  source: "configured",
  key: "zoo",
  baseUrl: "http://localhost:5090/ogc-api",
  executeRoute: "relay",
  readRoute: "relay",
  callbacks: false,
  processes: ["hellojs", "Buffer", "NotThere"],
};

const typed: EndpointRef = { source: "typed", baseUrl: "http://localhost:5080" };

describe("listedProcesses", () => {
  it("keeps the configured ids, in the server's order, and says what it left out", () => {
    const { processes, listFilter } = listedProcesses(zoo, list);
    expect(processes.processes.map((entry) => entry.id)).toEqual(["Buffer", "hellojs"]);
    expect(listFilter).toEqual({ read: 4, missing: ["NotThere"], applied: true });
  });

  it("keeps the narrowed list's truncation and total, so the screen can hedge what is missing", () => {
    const { processes } = listedProcesses(zoo, { ...list, truncated: true, numberTotal: 703 });
    expect(processes.truncated).toBe(true);
    expect(processes.numberTotal).toBe(703);
  });

  it("shows everything when none of the configured ids was read, and says so", () => {
    const renamed: EndpointRef = { ...zoo, processes: ["EchoProcess", "NotThere"] };
    expect(listedProcesses(renamed, list)).toEqual({
      processes: list,
      listFilter: { read: 4, missing: ["EchoProcess", "NotThere"], applied: false },
    });
  });

  it("shows everything for an endpoint that names no processes, and for a typed one", () => {
    const all: EndpointRef = { ...zoo, processes: undefined };
    expect(listedProcesses(all, list)).toEqual({ processes: list, listFilter: undefined });
    expect(listedProcesses(typed, list)).toEqual({ processes: list, listFilter: undefined });
  });

  it("is kept when the endpoint is handed to the relay", () => {
    expect(relayEndpointFor(zoo).processes).toEqual(["hellojs", "Buffer", "NotThere"]);
    expect(relayEndpointFor({ ...zoo, processes: undefined })).not.toHaveProperty("processes");
  });
});

describe("what the list says", () => {
  const narrowed = (read: ProcessList) => {
    const { processes, listFilter } = listedProcesses(zoo, read);
    if (listFilter === undefined) throw new Error("expected a filter");
    return narrowedCount(listFilter, processes);
  };

  it("gives one count, and the server's total only when it is more than was read", () => {
    expect(narrowed(list)).toBe(
      "2 of the 4 processes this server lists, as configured for this service. Configured but not on the server: NotThere.",
    );
    expect(narrowed({ ...list, numberTotal: 4 })).not.toContain("reports");
    expect(narrowed({ ...list, numberTotal: 703 })).toContain(
      "2 of the 4 processes this server lists, as configured for this service (it reports 703).",
    );
  });

  it("on a list cut short, calls a missing id not among those read, not absent from the server", () => {
    const words = narrowed({ ...list, truncated: true });
    expect(words).toContain("the list was cut short after too many pages");
    expect(words).toContain("Configured but not among those read: NotThere.");
    expect(words).not.toContain("not on the server");
  });

  it("says so when none of the configured ids was read", () => {
    const filter = { read: 4, missing: ["EchoProcess"], applied: false };
    expect(unappliedNote(filter, list)).toBe(
      "None of the processes configured for this service is on the server, so all are listed. Configured: EchoProcess.",
    );
    expect(unappliedNote(filter, { ...list, truncated: true })).toContain("is among those read");
  });
});

describe("ProcessListScreen with a configured process list", () => {
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

  const service: ServiceDescription = {
    url: "http://localhost:5090/ogc-api/",
    links: [],
    capabilities: unknownCapabilities(),
  };

  function render(endpoint: EndpointRef, read: ProcessList): HTMLElement {
    const { processes, listFilter } = listedProcesses(endpoint, read);
    host = document.createElement("div");
    document.body.append(host);
    const created = createRoot(host);
    root = created;
    act(() => {
      created.render(
        <ProcessListScreen
          endpoint={endpoint}
          service={service}
          processes={processes}
          listFilter={listFilter}
          opening={undefined}
          error={undefined}
          onOpen={() => undefined}
          onDisconnect={() => undefined}
        />,
      );
    });
    return host;
  }

  const ids = (view: HTMLElement) =>
    [...view.querySelectorAll("code.process-id")].map((code) => code.textContent);

  it("lists only the configured processes, under one count line, with the server's size beside", () => {
    const view = render(zoo, { ...list, numberTotal: 703 });
    expect(ids(view)).toEqual(["Buffer", "hellojs"]);
    const counts = view.querySelectorAll(".list-count");
    expect(counts).toHaveLength(1);
    expect(counts[0]?.getAttribute("data-testid")).toBe("list-filter");
    expect(counts[0]?.textContent).toContain(
      "2 of the 4 processes this server lists, as configured for this service (it reports 703)",
    );
    expect(view.querySelector(".fact-processes dd")?.textContent).toBe("703");
    expect(view.querySelector('[data-testid="list-unfiltered"]')).toBeNull();
  });

  it("lists everything when none of the configured ids is on the server, and says so", () => {
    const view = render({ ...zoo, processes: ["EchoProcess"] }, list);
    expect(ids(view)).toEqual(["Buffer", "SAGA.x", "hellojs", "OTB.y"]);
    expect(view.querySelector('[data-testid="list-unfiltered"]')?.textContent).toContain(
      "None of the processes configured for this service is on the server, so all are listed.",
    );
    expect(view.querySelector(".list-count")?.textContent).toBe("4 processes.");
  });

  it("says nothing of a configuration for an endpoint that names no processes", () => {
    const view = render(typed, list);
    expect(ids(view)).toHaveLength(4);
    expect(view.querySelector('[data-testid="list-filter"]')).toBeNull();
    expect(view.querySelector('[data-testid="list-unfiltered"]')).toBeNull();
  });
});
