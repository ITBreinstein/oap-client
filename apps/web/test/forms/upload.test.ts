/**
 * The checks a picked file passes before its content becomes a value.
 */

import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, refuseJsonObject, refuseSize } from "../../src/forms/upload.js";

describe("refuseSize", () => {
  it("lets a file at the limit through, and refuses one byte more, saying both sizes", () => {
    expect(refuseSize(MAX_UPLOAD_BYTES)).toBeUndefined();
    expect(refuseSize(MAX_UPLOAD_BYTES + 1)).toBe(
      "That file is 10.0 MB. This page reads files up to 10.0 MB, so it was not opened.",
    );
    expect(refuseSize(512 * 1024 * 1024)).toMatch(/^That file is 512\.0 MB\./);
  });
});

describe("refuseJsonObject", () => {
  it("accepts a JSON object", () => {
    expect(refuseJsonObject('{"type":"FeatureCollection","features":[]}')).toBeUndefined();
  });

  it("refuses text that is not JSON, and JSON that is not an object", () => {
    expect(refuseJsonObject("<gml:Polygon/>")).toBe(
      "That file is not valid JSON, so the value was not changed.",
    );
    expect(refuseJsonObject("[1, 2]")).toBe(
      "That file is JSON, but not a JSON object, so the value was not changed.",
    );
    expect(refuseJsonObject("null")).toMatch(/not a JSON object/);
  });
});
