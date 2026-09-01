/**
 * Building the execute request.
 *
 * The `Content-Type` test here is the T1 assertion, and it is a unit test on
 * purpose. The reduction habit is kept everywhere else in this repo, but the
 * live version of this one — POST a bad content type at ZOO — crashes the
 * kernel with SIGSEGV (finding 0015). A fake `fetch` proves the same property
 * without taking down someone else's process.
 */

import { describe, expect, it } from "vitest";
import {
  buildHeaders,
  buildPayload,
  buildRequest,
  checkArity,
  describeInputKind,
  executionUrlFor,
  resolveExecutionUrl,
} from "../../src/execution/build-request.js";
import { parseDescription } from "../../src/processes/parse-description.js";
import type { ProcessDescription } from "../../src/processes/types.js";
import helloWorld from "../fixtures/pygeoapi/processes/hello-world.json" with { type: "json" };
import echo from "../fixtures/zoo-project/processes/echo.json" with { type: "json" };

const LIST = "https://service.test/oapi/processes";

function describeFrom(document: unknown, url: string): ProcessDescription {
  return parseDescription(document, { documentUrl: url }).process;
}

describe("executionUrlFor", () => {
  it("appends {id}/execution under the list path", () => {
    expect(executionUrlFor(LIST, "hello-world")).toBe(`${LIST}/hello-world/execution`);
  });

  it("encodes an id that would otherwise address a different resource", () => {
    expect(executionUrlFor(LIST, "a/b")).toBe(`${LIST}/a%2Fb/execution`);
    expect(executionUrlFor(LIST, "with space")).toBe(`${LIST}/with%20space/execution`);
  });

  it("keeps ids that legitimately contain dots readable", () => {
    expect(executionUrlFor(LIST, "org.n52.javaps.test.EchoProcess")).toBe(
      `${LIST}/org.n52.javaps.test.EchoProcess/execution`,
    );
  });

  it("drops a ?f=json query rather than carrying it onto the execution path", () => {
    // A list reached through the format fallback ends in a query; appending
    // there would land the guess one path segment too high.
    expect(executionUrlFor(`${LIST}?f=json`, "hello-world")).toBe(`${LIST}/hello-world/execution`);
  });
});

describe("resolveExecutionUrl", () => {
  it("prefers the execute link pygeoapi advertises over a rebuilt path", () => {
    const description = describeFrom(helloWorld, "https://service.test/oapi/processes/hello-world");
    const { url, route } = resolveExecutionUrl(LIST, "hello-world", description);

    expect(route).toBe("advertised-link");
    expect(url).toBe("http://localhost:5080/processes/hello-world/execution?f=json");
  });

  it("prefers the execute link ZOO advertises, which is only in the long OGC URI form", () => {
    // Neither reference server writes the short `execute` relation. Matching
    // only the short form would find neither, and would silently fall back to
    // a constructed path against a server behind a path prefix.
    const description = describeFrom(echo, "http://localhost:5090/ogc-api/processes/echo");
    const { url, route } = resolveExecutionUrl(LIST, "echo", description);

    expect(route).toBe("advertised-link");
    expect(url).toBe("http://localhost:5090/ogc-api/processes/echo/execution");
  });

  it("falls back to the constructed path when no description is supplied", () => {
    const { url, route } = resolveExecutionUrl(LIST, "hello-world", undefined);
    expect(route).toBe("constructed-path");
    expect(url).toBe(`${LIST}/hello-world/execution`);
  });
});

describe("buildHeaders", () => {
  it("always sets Content-Type: application/json — the T1 assertion", () => {
    // fetch() fills this in as text/plain;charset=UTF-8 when a string body is
    // passed without it, and ZOO answers that with signal 11 (finding 0015).
    // This is the only place that guarantee is checked, because the live
    // version of the check crashes the server.
    for (const mode of ["sync", "async"] as const) {
      expect(buildHeaders(mode)["Content-Type"]).toBe("application/json");
    }
  });

  it("sets an explicit wildcard Accept, never the browser default", () => {
    // Not the same as omitting it: a browser with no Accept sends its own
    // ranked list with text/html first and gets a web page (finding 0007).
    expect(buildHeaders("sync")["Accept"]).toBe("*/*");
  });

  it("sends no Prefer header for sync, which is the Part 1 v1.0 default", () => {
    expect(buildHeaders("sync")["Prefer"]).toBeUndefined();
  });

  it("sends Prefer: respond-async for async", () => {
    expect(buildHeaders("async")["Prefer"]).toBe("respond-async");
  });
});

describe("buildPayload", () => {
  it("passes inputs through unchanged, including nested and array values", () => {
    const inputs = {
      message: "plugfest",
      count: 42,
      bbox: { bbox: [4.3, 52.0, 4.4, 52.1], crs: "urn:ogc:def:crs:EPSG:6.6:4326" },
      many: ["a", "b"],
    };
    expect(buildPayload({ inputs }).inputs).toEqual(inputs);
  });

  it("omits outputs entirely when the caller supplies none", () => {
    // T9. pygeoapi declares outputTransmission: ["value"] only, so a
    // synthesised block asking for "reference" would be a self-inflicted
    // failure — and choosing outputs is apps/web's decision under §7.2.
    const payload = buildPayload({ inputs: { name: "p" } });
    expect("outputs" in payload).toBe(false);
    expect(JSON.stringify(payload)).toBe('{"inputs":{"name":"p"}}');
  });

  it("omits response entirely when the caller supplies none", () => {
    expect("response" in buildPayload({ inputs: {} })).toBe(false);
  });

  it("includes outputs and response verbatim when supplied", () => {
    const payload = buildPayload({
      inputs: { name: "p" },
      outputs: { echo: { transmissionMode: "reference" } },
      response: "document",
    });
    expect(payload.outputs).toEqual({ echo: { transmissionMode: "reference" } });
    expect(payload.response).toBe("document");
  });
});

describe("describeInputKind", () => {
  it("names kinds without ever carrying the value", () => {
    expect(describeInputKind("plugfest")).toBe("string");
    expect(describeInputKind(42)).toBe("number");
    expect(describeInputKind(true)).toBe("boolean");
    expect(describeInputKind(null)).toBe("null");
    expect(describeInputKind({ href: "https://example.test/a.tif" })).toBe("reference");
    expect(describeInputKind({ value: "x", mediaType: "text/xml" })).toBe("qualified value");
    expect(describeInputKind({ type: "Point", coordinates: [1, 2] })).toBe("object");
    expect(describeInputKind([1, 2, 3, 4])).toBe("array of 4 number");
    expect(describeInputKind(["a", 1])).toBe("array of 2 mixed");
  });
});

describe("checkArity", () => {
  const description: ProcessDescription = {
    id: "arity",
    execution: { sync: true, async: false, dismiss: false, declared: [], defaulted: true },
    outputTransmission: ["value"],
    links: [],
    outputs: [],
    inputs: [
      {
        id: "one",
        minOccurs: 1,
        maxOccurs: 1,
        required: true,
        multiple: false,
        schema: {},
      },
      {
        id: "many",
        minOccurs: 0,
        maxOccurs: "unbounded",
        required: false,
        multiple: true,
        schema: {},
      },
    ],
  };

  it("warns when a single-valued input is given an array", () => {
    expect(checkArity(description, { one: ["a"] })).toContain(
      'input "one" accepts one value but an array was supplied',
    );
  });

  it("warns when a multi-valued input is given a bare value", () => {
    expect(checkArity(description, { one: "a", many: "b" })).toContain(
      'input "many" accepts multiple values but a single value was supplied',
    );
  });

  it("warns when a required input is missing", () => {
    // A missing required input might still be the server's own default kicking
    // in, so this warns and the request is sent anyway. See T3.
    expect(checkArity(description, {})).toContain('missing required input "one"');
  });

  it("warns about an input the description does not declare", () => {
    expect(checkArity(description, { one: "a", nosuch: "x" })).toContain(
      'input "nosuch" is not declared by this process',
    );
  });

  it("is silent when the shapes match", () => {
    expect(checkArity(description, { one: "a", many: ["b", "c"] })).toEqual([]);
  });

  it("checks nothing at all without a description", () => {
    expect(checkArity(undefined, { anything: ["a"] })).toEqual([]);
  });
});

describe("buildRequest", () => {
  it("records input ids and kinds but never the values", () => {
    const request = buildRequest(LIST, "hello-world", {
      inputs: { name: "a secret the user typed", bbox: [4.3, 52.0, 4.4, 52.1] },
    });

    expect(request.inputIds).toEqual(["name", "bbox"]);
    expect(request.inputKinds).toEqual(["string", "array of 4 number"]);
    expect(JSON.stringify(request.inputKinds)).not.toContain("secret");
  });

  it("serialises the body once, so the runtime derives the right Content-Length", () => {
    const request = buildRequest(LIST, "hello-world", { inputs: { name: "p" } });
    expect(request.body).toBe('{"inputs":{"name":"p"}}');
  });
});
