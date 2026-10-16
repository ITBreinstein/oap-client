/**
 * The page's place in its address: read, written beside the other
 * parameters, compared, and when leaving would lose something.
 */

import { describe, expect, it } from "vitest";
import {
  inTransit,
  placeInSearch,
  samePlace,
  withPlace,
  wouldLoseWork,
} from "../../src/app/address.js";
import type { Workflow } from "../../src/app/workflow.js";

describe("placeInSearch", () => {
  it("reads a service, and a process there", () => {
    expect(placeInSearch("?service=https://example.org/ogcapi&process=buffer")).toEqual({
      service: "https://example.org/ogcapi",
      process: "buffer",
    });
    expect(placeInSearch("?service=https://example.org/ogcapi/")).toEqual({
      service: "https://example.org/ogcapi",
    });
  });

  it("ignores a service that isn't an http(s) address, and a process without one", () => {
    expect(placeInSearch("?service=javascript:alert(1)&process=x")).toEqual({});
    expect(placeInSearch("?service=not%20a%20url")).toEqual({});
    expect(placeInSearch("?process=buffer")).toEqual({});
    expect(placeInSearch("?service=https://example.org&process=%20")).toEqual({
      service: "https://example.org",
    });
  });
});

describe("withPlace", () => {
  it("keeps every other parameter, in its order", () => {
    expect(
      withPlace("?style=instrument-updated&theme=dark", {
        service: "https://example.org/ogcapi",
        process: "buffer",
      }),
    ).toBe(
      "?style=instrument-updated&theme=dark&service=https%3A%2F%2Fexample.org%2Fogcapi&process=buffer",
    );
    expect(withPlace("?developer&service=https://a.example&process=p", {})).toBe("?developer=");
    expect(withPlace("?service=https://a.example", {})).toBe("");
  });

  it("is read back as the place it wrote", () => {
    const place = { service: "https://example.org/ogc api", process: "a&b" };
    expect(placeInSearch(withPlace("?theme=dark", place))).toEqual(place);
  });
});

describe("samePlace", () => {
  it("takes a slash at the end of the address as the same service", () => {
    expect(samePlace({ service: "https://a.example/" }, { service: "https://a.example" })).toBe(
      true,
    );
    expect(
      samePlace({ service: "https://a.example", process: "p" }, { service: "https://a.example" }),
    ).toBe(false);
    expect(samePlace({}, {})).toBe(true);
  });
});

/** Just enough of a state for the functions under test. */
const at = (state: object) => state as Workflow;

describe("wouldLoseWork", () => {
  it("is true while a run is under way", () => {
    expect(wouldLoseWork(at({ stage: "running" }))).toBe(true);
  });

  it("is true for a form with something typed, false for one left as it came", () => {
    expect(wouldLoseWork(at({ stage: "process", values: { name: "Geonovum" } }))).toBe(true);
    expect(wouldLoseWork(at({ stage: "process", values: { name: "", list: [] } }))).toBe(false);
    expect(wouldLoseWork(at({ stage: "process", values: {} }))).toBe(false);
  });

  it("is false anywhere else", () => {
    expect(wouldLoseWork(at({ stage: "connected" }))).toBe(false);
    expect(wouldLoseWork(at({ stage: "result" }))).toBe(false);
  });
});

describe("inTransit", () => {
  it("is true while connecting, asking about the relay, or reading a description", () => {
    expect(inTransit(at({ stage: "choose-endpoint", connecting: {} }))).toBe(true);
    expect(inTransit(at({ stage: "choose-endpoint", offer: {} }))).toBe(true);
    expect(inTransit(at({ stage: "connected", opening: "buffer" }))).toBe(true);
    expect(inTransit(at({ stage: "choose-endpoint" }))).toBe(false);
    expect(inTransit(at({ stage: "connected" }))).toBe(false);
  });
});
