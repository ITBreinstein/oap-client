import { ProcessesError, TransportError, createEnvelope } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { describeFailure } from "../../src/results/describe-failure.js";

function exception(status: number, body: unknown): ProcessesError {
  const envelope = createEnvelope(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/problem+json" },
    }),
    { requestedUrl: "http://localhost/processes/x/execution" },
  );
  return new ProcessesError("refused", {
    kind: "exception",
    envelope,
    problem: {
      type: "about:blank",
      title: typeof body === "object" && body !== null ? (body as never)["title"] : undefined,
      status,
      detail: typeof body === "object" && body !== null ? (body as never)["detail"] : undefined,
      instance: undefined,
      extensions: (body ?? {}) as Record<string, unknown>,
    },
  });
}

describe("what a refusal says", () => {
  it("uses pygeoapi's non-standard description", () => {
    const failure = describeFailure(
      exception(400, {
        type: "InvalidParameterValue",
        code: "InvalidParameterValue",
        description: "Error executing process: latitude and longitude are required",
      }),
    );

    expect(failure.summary).toContain("400");
    expect(failure.detail).toBe("Error executing process: latitude and longitude are required");
  });

  it("uses ZOO's RFC 7807 detail", () => {
    const failure = describeFailure(
      exception(500, {
        title: "NoApplicableCode",
        type: "NoApplicableCode",
        detail: "ZOO Kernel failed to process your request",
      }),
    );

    expect(failure.detail).toBe("ZOO Kernel failed to process your request");
  });
});

describe("a request that never arrived", () => {
  it("names CORS when the server was on another origin", () => {
    const failure = describeFailure(
      new TransportError("Load failed", "http://localhost:5090/ogc-api", true),
    );

    expect(failure.summary).toContain("never reached");
    expect(failure.hint).toContain("CORS");
  });

  it("does not blame CORS for a same-origin failure", () => {
    const failure = describeFailure(
      new TransportError("Load failed", "http://localhost:5173/x", false),
    );

    expect(failure.hint).toBeUndefined();
  });
});

it("falls back to the message for anything else", () => {
  expect(describeFailure(new Error("boom")).summary).toBe("boom");
  expect(describeFailure("boom").summary).toBe("boom");
});
