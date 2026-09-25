/**
 * The session's observations, attributed to endpoints: the panel's filters
 * and the per-endpoint file the interoperability matrix is built from.
 */

import { describe, expect, it } from "vitest";
import {
  kindCounts,
  observationExport,
  observedEndpoints,
  type SessionObservation,
} from "../src/observations.js";

const cors = "http://localhost:5080";
const zoo = "http://localhost:5090/ogc-api";

const capabilities: SessionObservation = {
  endpoint: cors,
  observation: {
    kind: "capabilities-derived",
    sync: true,
    async: true,
    dismiss: false,
    callback: false,
    jobList: true,
  },
};
const form = (endpoint: string, processId: string): SessionObservation => ({
  endpoint,
  observation: {
    kind: "form",
    endpoint,
    processId,
    inputId: "x",
    code: "unsupported-keyword",
    keyword: "oneOf",
    crs: undefined,
  },
});
const session = [capabilities, form(zoo, "echo"), form(cors, "hello-world"), form(zoo, "echo")];
const at = new Date("2026-09-25T12:00:00Z");

describe("observedEndpoints", () => {
  it("lists each endpoint once, in the order first seen", () => {
    expect(observedEndpoints(session)).toEqual([cors, zoo]);
  });
});

describe("kindCounts", () => {
  it("counts each kind, most frequent first", () => {
    expect(kindCounts(session)).toEqual([
      { kind: "form", count: 3 },
      { kind: "capabilities-derived", count: 1 },
    ]);
  });
});

describe("observationExport", () => {
  it("writes the whole session as a flat list, with no endpoint", () => {
    const exported = JSON.parse(observationExport(session, "0.4.0", at)) as Record<string, unknown>;
    expect(exported).toEqual({
      exportedAt: "2026-09-25T12:00:00.000Z",
      coreVersion: "0.4.0",
      observations: session.map((entry) => entry.observation),
    });
  });

  it("writes one endpoint's observations, including those that carry no URL, and names it", () => {
    const exported = JSON.parse(observationExport(session, "0.4.0", at, cors)) as Record<
      string,
      unknown
    >;
    expect(exported).toEqual({
      exportedAt: "2026-09-25T12:00:00.000Z",
      coreVersion: "0.4.0",
      endpoint: cors,
      observations: [capabilities.observation, form(cors, "hello-world").observation],
    });
  });
});
