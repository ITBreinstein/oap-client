/**
 * The page's place in its address: read, written beside the other
 * parameters, compared, and when leaving would lose something.
 */

import { describe, expect, it } from "vitest";
import {
  inTransit,
  jobIdIn,
  jobUrl,
  placeInSearch,
  samePlace,
  sharedSearch,
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

describe("a job in the address", () => {
  const service = "https://example.org/ogcapi";

  it("is read with its process, and means nothing without one", () => {
    expect(placeInSearch(`?service=${service}&process=buffer&job=6f2c`)).toEqual({
      service,
      process: "buffer",
      job: "6f2c",
    });
    expect(placeInSearch(`?service=${service}&job=6f2c`)).toEqual({ service });
  });

  it("is written beside the rest, and read back as written", () => {
    const place = { service, process: "buffer", job: "a b/c" };
    expect(placeInSearch(withPlace("?theme=dark", place))).toEqual(place);
    expect(withPlace("?job=old", { service })).not.toContain("job=");
  });

  it("is the id of a job whose status is where the standard puts it, and only then", () => {
    expect(jobIdIn(service, `${service}/jobs/6f2c`)).toBe("6f2c");
    expect(jobIdIn(`${service}/`, `${service}/jobs/a%20b`)).toBe("a b");
    expect(jobUrl(service, "a b")).toBe(`${service}/jobs/a%20b`);
    // Elsewhere, or with more after it: no id could find it again.
    expect(jobIdIn(service, "https://other.example/jobs/6f2c")).toBeUndefined();
    expect(jobIdIn(service, `${service}/jobs/6f2c/results`)).toBeUndefined();
    expect(jobIdIn(service, `${service}/jobs/6f2c?f=json`)).toBeUndefined();
    expect(jobIdIn(service, `${service}/jobs/`)).toBeUndefined();
  });

  it("makes two places different", () => {
    expect(samePlace({ service, process: "p", job: "1" }, { service, process: "p" })).toBe(false);
  });
});

describe("sharedSearch", () => {
  it("leaves out the sender's style and theme, and keeps the rest (#34)", () => {
    const job = { service: "https://example.org/ogcapi", process: "slow", job: "6f2c" };
    expect(sharedSearch("?style=instrument-updated&theme=dark", job)).toBe(
      "?service=https%3A%2F%2Fexample.org%2Fogcapi&process=slow&job=6f2c",
    );
    expect(sharedSearch("?theme=light&developer&style=instrument", job)).toBe(
      "?developer=&service=https%3A%2F%2Fexample.org%2Fogcapi&process=slow&job=6f2c",
    );
    expect(placeInSearch(sharedSearch("?style=instrument", job))).toEqual(job);
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
    expect(wouldLoseWork(at({ stage: "running", run: { mode: "sync" } }))).toBe(true);
    expect(wouldLoseWork(at({ stage: "running", run: { mode: "async" } }))).toBe(true);
  });

  it("is false for a background job with a link: it goes on, and the address comes back to it", () => {
    const endpoint = { baseUrl: "https://example.org/ogcapi" };
    const running = (jobRef: string) =>
      at({ stage: "running", endpoint, run: { mode: "async", jobRef } });
    expect(wouldLoseWork(running("https://example.org/ogcapi/jobs/1"))).toBe(false);
    // A job the address can't name is lost with the page, as a run is.
    expect(wouldLoseWork(running("https://elsewhere.example/status/1"))).toBe(true);
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
