/**
 * #37: the browser tab says where the page is, what is on screen first and
 * the service last.
 */

import { describe, expect, it } from "vitest";
import { pageTitle } from "../../src/app/titles.js";

describe("pageTitle", () => {
  it("names each stage", () => {
    expect(pageTitle({ stage: "choose-endpoint" })).toBe("Connect · Breinstein");
    expect(pageTitle({ stage: "connected", service: "pygeoapi" })).toBe("Processes · pygeoapi");
    expect(pageTitle({ stage: "process", service: "pygeoapi", process: "Slow process" })).toBe(
      "Slow process · pygeoapi",
    );
    expect(pageTitle({ stage: "result", service: "pygeoapi", process: "Slow process" })).toBe(
      "Slow process: result · pygeoapi",
    );
  });

  it("calls a run under way the process's own place", () => {
    expect(pageTitle({ stage: "running", service: "pygeoapi", process: "Slow process" })).toBe(
      "Slow process · pygeoapi",
    );
  });
});
