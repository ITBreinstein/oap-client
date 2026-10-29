/**
 * What a process needs (4.5): an area whenever one of its inputs is drawn on
 * the map, however the schema said GeoJSON, and whether it repeats.
 */

import { describe, expect, it } from "vitest";
import { needsOfPlan } from "../../src/app/needs.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";
import { fixtureProcess, planFor } from "../forms/helpers.js";

const needsOf = (key: string) => needsOfPlan(resolveFormPlan(fixtureProcess(key)));

describe("needsOfPlan", () => {
  it("says area for a oneOf of GeoJSON geometries (#G2)", () => {
    expect(needsOf("beleidsnormen/regel_30")).toBe("area");
    expect(needsOf("beleidsnormen/geluidsbelasting")).toBe("area");
  });

  it("says area for a repeatable structural FeatureCollection alone (#G3)", () => {
    expect(
      needsOfPlan(
        planFor({
          points: {
            schema: {
              type: "object",
              properties: {
                type: { enum: ["FeatureCollection"] },
                features: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { enum: ["Feature"] },
                      geometry: {
                        type: "object",
                        properties: { type: { enum: ["Point"] }, coordinates: { type: "array" } },
                      },
                    },
                  },
                },
              },
            },
            maxOccurs: "unbounded",
          },
        }),
      ),
    ).toBe("area");
  });

  it("still says values for a form of values", () => {
    expect(needsOf("pygeoapi/hello-world")).toBe("values");
  });
});
