import { describe, expect, it } from "vitest";
import { OgcApiError, VERSION } from "../src/index.js";

describe("core", () => {
  it("exposes a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("carries the server's problem document", () => {
    const err = new OgcApiError("boom", 500, { type: "about:blank", status: 500 });
    expect(err.problem?.status).toBe(500);
  });
});
