/**
 * The session's observations, attributed to endpoints: the panel's filters
 * and the per-endpoint file the interoperability matrix is built from.
 */

import { describe, expect, it } from "vitest";
import { fixtureProcess, planFor } from "./forms/helpers.js";
import { resolveFormPlan } from "../src/forms/resolve.js";
import {
  geometryObservationsFor,
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
    recognisedBy: undefined,
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
    const exported = JSON.parse(observationExport(session, "0.4.0", { now: at })) as Record<
      string,
      unknown
    >;
    expect(exported).toEqual({
      exportedAt: "2026-09-25T12:00:00.000Z",
      coreVersion: "0.4.0",
      observations: session.map((entry) => entry.observation),
    });
  });

  it("writes one endpoint's observations, including those that carry no URL, and names it", () => {
    const exported = JSON.parse(
      observationExport(session, "0.4.0", { now: at, endpoint: cors }),
    ) as Record<string, unknown>;
    expect(exported).toEqual({
      exportedAt: "2026-09-25T12:00:00.000Z",
      coreVersion: "0.4.0",
      endpoint: cors,
      observations: [capabilities.observation, form(cors, "hello-world").observation],
    });
  });

  it("says when the session dropped observations, so the file is known to be incomplete", () => {
    const exported = JSON.parse(
      observationExport(session, "0.4.0", { now: at, endpoint: zoo, dropped: 3 }),
    ) as Record<string, unknown>;
    expect(exported["droppedObservations"]).toBe(3);
  });
});

describe("geometryObservationsFor", () => {
  it("names each geometry input and its pattern, a repeatable one included, and nothing else", () => {
    const plan = resolveFormPlan(fixtureProcess("pygeoapi/breinstein-rotate"));
    const observations = geometryObservationsFor(`${cors}/?token=secret`, "rotate", plan.fields);
    expect(observations).toEqual([
      {
        kind: "form",
        endpoint: `${cors}/`,
        processId: "rotate",
        inputId: plan.fields[0]?.id,
        code: "geometry-recognised",
        keyword: undefined,
        crs: undefined,
        recognisedBy: "format",
      },
    ]);
    const repeatable = planFor({
      places: { schema: { $ref: "https://geojson.org/schema/Point.json" }, maxOccurs: 3 },
      label: { schema: { type: "string" } },
    });
    expect(geometryObservationsFor(cors, "demo", repeatable.fields)).toMatchObject([
      { inputId: "places", code: "geometry-recognised", recognisedBy: "ref" },
    ]);
  });
});
