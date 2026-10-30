/**
 * Naming the OGC exception a problem document's `type` points at, whichever
 * scheme it is written in: 1.0 writes `http://`, the 2.0 draft `https://` —
 * except for `no-such-output`, which it left on `http://` (its issue #619).
 */

import { describe, expect, it } from "vitest";
import { ogcExceptionOf, toProblemDetails } from "../../src/http/problem.js";

const BASE = "www.opengis.net/def/exceptions/ogcapi-processes-1/1.0";

describe("ogcExceptionOf", () => {
  for (const name of [
    "no-such-process",
    "no-such-job",
    "result-not-ready",
    "result-not-available",
    "no-such-output",
  ] as const) {
    it(`names ${name}, written http:// or https://`, () => {
      expect(ogcExceptionOf(`http://${BASE}/${name}`)).toBe(name);
      expect(ogcExceptionOf(`https://${BASE}/${name}`)).toBe(name);
    });
  }

  it("ignores the case of the host", () => {
    expect(
      ogcExceptionOf(`https://WWW.OpenGIS.net/def/exceptions/ogcapi-processes-1/1.0/no-such-job`),
    ).toBe("no-such-job");
  });

  it("names nothing for another host, family, name, or a longer path", () => {
    expect(
      ogcExceptionOf(`https://example.org/def/exceptions/ogcapi-processes-1/1.0/no-such-job`),
    ).toBeUndefined();
    expect(
      ogcExceptionOf(`https://www.opengis.net/def/exceptions/ogcapi-processes-2/1.0/no-such-job`),
    ).toBeUndefined();
    expect(ogcExceptionOf(`https://${BASE}/invalid-query-parameter-value`)).toBeUndefined();
    expect(ogcExceptionOf(`https://${BASE}/no-such-job/extra`)).toBeUndefined();
    expect(ogcExceptionOf(`ftp://${BASE}/no-such-job`)).toBeUndefined();
  });

  it("names nothing for a type that is no URL", () => {
    expect(ogcExceptionOf("NoSuchProcess")).toBeUndefined();
    expect(ogcExceptionOf("about:blank")).toBeUndefined();
  });
});

describe("toProblemDetails", () => {
  it("carries the name on the problem when the type is one", () => {
    const problem = toProblemDetails(
      { type: `https://${BASE}/result-not-available`, title: "Result not available", status: 404 },
      { declared: true, wireStatus: 404 },
    );
    expect(problem?.ogcException).toBe("result-not-available");
  });

  it("leaves it off for any other type: pygeoapi's code is not guessed at", () => {
    const problem = toProblemDetails(
      { type: "NoSuchProcess", code: "NoSuchProcess", description: "process not found" },
      { declared: false, wireStatus: 404 },
    );
    expect(problem).toBeDefined();
    expect(problem).not.toHaveProperty("ogcException");
  });
});
