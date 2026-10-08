import { describe, expect, it } from "vitest";
import { BODY_PREVIEW_LIMIT, classify, requireOk } from "../../src/http/classify.js";
import { createEnvelope } from "../../src/http/envelope.js";
import { AbortError, ProcessesError } from "../../src/http/errors.js";
import { stalledBody } from "./stalled-body.js";

const URL_UNDER_TEST = "https://example.org/ogc/processes/echo/execution";

interface Init {
  readonly status?: number;
  readonly headers?: Record<string, string>;
}

function envelope(body: BodyInit | null, init: Init = {}) {
  return createEnvelope(new Response(body, init), { requestedUrl: URL_UNDER_TEST });
}

/** A response that declares `application/problem+json`, unless told otherwise. */
function json(body: unknown, init: Init = {}) {
  return envelope(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/problem+json", ...init.headers },
  });
}

describe("classify", () => {
  // The reason the classifier exists. If it is ever reduced to a status check,
  // this is the test that goes red.
  it("calls a 200 carrying a problem document an exception, not ok", async () => {
    const result = await classify(
      json(
        {
          type: "https://api.example.org/errors/no-such-process",
          title: "No such process",
          status: 404,
          detail: "Process 'echo' is not on this server",
          instance: "/processes/echo",
          code: "NoSuchProcess",
        },
        { status: 200 },
      ),
    );

    expect(result.kind).toBe("exception");
    if (result.kind !== "exception") return;
    expect(result.problem.type).toBe("https://api.example.org/errors/no-such-process");
    expect(result.problem.title).toBe("No such process");
    expect(result.problem.detail).toBe("Process 'echo' is not on this server");
    expect(result.problem.instance).toBe("/processes/echo");
    // The body's claimed status and the wire status are both kept, unreconciled.
    expect(result.problem.status).toBe(404);
    expect(result.envelope.status).toBe(200);
    // Unrecognised members survive rather than being dropped.
    expect(result.problem.extensions).toEqual({ code: "NoSuchProcess" });
  });

  it("recognises a problem document with only a title", async () => {
    const result = await classify(json({ title: "Server too busy" }, { status: 503 }));
    expect(result.kind).toBe("exception");
    if (result.kind !== "exception") return;
    // RFC 7807's default for an absent type.
    expect(result.problem.type).toBe("about:blank");
  });

  it("reads a problem document sent as plain application/json", async () => {
    const result = await classify(
      envelope(JSON.stringify({ type: "about:blank", title: "Bad request" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    );
    expect(result.kind).toBe("exception");
  });

  it("takes a 200 problem document on its declared media type alone", async () => {
    // No URI-shaped type, no claimed status — only the content type says so.
    const result = await classify(json({ type: "gone-wrong" }, { status: 200 }));
    expect(result.kind).toBe("exception");
  });

  it("takes a 200 with a URI-shaped type and a detail", async () => {
    const result = await classify(
      envelope(JSON.stringify({ type: "https://example.test/errors/x", detail: "it broke" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result.kind).toBe("exception");
  });

  // A synchronous result is free to carry a URI-shaped `type`. Read as a
  // problem document, the result would be thrown away as an exception.
  it.each([
    [{ type: "urn:ogc:def:crs:EPSG::4326", value: [5, 52] }],
    [{ type: "EPSG:4326", title: "Amersfoort" }],
    [{ type: "https://schema.org/Place", title: "Utrecht", status: "open" }],
  ])(
    "does not mistake a result with a URI-shaped type for a problem document: %j",
    async (body) => {
      const result = await classify(
        envelope(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      expect(result.kind).toBe("ok");
    },
  );

  it("takes a 200 whose body claims a failing status", async () => {
    const result = await classify(
      envelope(JSON.stringify({ title: "Internal error", status: 500 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result.kind).toBe("exception");
  });

  // The collisions that make "has a type or title" the wrong test. Both of
  // these are real pygeoapi 0.21 payloads, and both are successes.
  it("does not mistake a job document for a problem document", async () => {
    const result = await classify(
      envelope(
        JSON.stringify({
          type: "process",
          processID: "hello-world",
          jobID: "8d521b8a",
          status: "successful",
          progress: 100,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(result.kind).toBe("ok");
  });

  it("does not mistake a process description for a problem document", async () => {
    const result = await classify(
      envelope(JSON.stringify({ id: "hello-world", title: "Hello World", version: "0.2.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it("does not mistake a landing page for a problem document", async () => {
    const result = await classify(
      envelope(JSON.stringify({ title: "pygeoapi", description: "...", links: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(result.kind).toBe("ok");
  });

  // pygeoapi sends a bare token, not a URI, and plain application/json. The
  // failing status is what makes it readable as an exception.
  it("reads a failing status with a non-URI type as an exception", async () => {
    const result = await classify(
      envelope(
        JSON.stringify({ code: "NoSuchProcess", type: "NoSuchProcess", description: "Not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    expect(result.kind).toBe("exception");
    if (result.kind !== "exception") return;
    expect(result.problem.type).toBe("NoSuchProcess");
    expect(result.problem.extensions).toEqual({
      code: "NoSuchProcess",
      description: "Not found",
    });
  });

  it("reads a declared problem document with a non-string type or title as about:blank (C7)", async () => {
    // RFC 9457 §3.1: a member of the wrong type is treated as absent, and an
    // absent `type` is `about:blank`. Declared, it is still a problem document.
    const result = await classify(json({ type: 7, title: null }, { status: 400 }));
    expect(result.kind).toBe("exception");
    if (result.kind !== "exception") return;
    expect(result.problem).toMatchObject({ type: "about:blank", title: undefined });
  });

  it("ignores a non-string type or title on a body not declared as a problem", async () => {
    const result = await classify(
      json(
        { type: 7, title: null },
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    expect(result.kind).toBe("http-error");
  });

  it("takes a declared problem document at 200 with only detail and status for a failure (C7)", async () => {
    // Served at 200, it used to be classified ok, and execute() handed it over
    // as the result.
    const result = await classify(json({ detail: "backend unavailable", status: 503 }));
    expect(result.kind).toBe("exception");
    if (result.kind !== "exception") return;
    expect(result.problem).toMatchObject({
      type: "about:blank",
      detail: "backend unavailable",
      status: 503,
    });
  });

  it("classifies a 500 with an HTML body as http-error, with a preview", async () => {
    const html = "<!doctype html><html><body><h1>502 Bad Gateway</h1></body></html>";
    const result = await classify(
      envelope(html, { status: 500, headers: { "content-type": "text/html" } }),
    );

    expect(result.kind).toBe("http-error");
    if (result.kind !== "http-error") return;
    expect(result.bodyPreview).toBe(html);
  });

  it("truncates a long body preview", async () => {
    const result = await classify(
      envelope("x".repeat(5000), { status: 502, headers: { "content-type": "text/plain" } }),
    );
    expect(result.kind).toBe("http-error");
    if (result.kind !== "http-error") return;
    expect(result.bodyPreview).toHaveLength(BODY_PREVIEW_LIMIT + 1); // + the ellipsis
    expect(result.bodyPreview.endsWith("…")).toBe(true);
  });

  it("never throws: malformed JSON under a JSON content type falls through", async () => {
    const result = await classify(
      envelope("{ this is not json", {
        status: 500,
        headers: { "content-type": "application/problem+json" },
      }),
    );
    expect(result.kind).toBe("http-error");
    if (result.kind !== "http-error") return;
    expect(result.bodyPreview).toBe("{ this is not json");
  });

  it("never throws: a JSON array body is not a problem document", async () => {
    const result = await classify(json([{ type: "x" }], { status: 400 }));
    expect(result.kind).toBe("http-error");
  });

  it("gives an empty preview when the body cannot be read", async () => {
    const over = createEnvelope(
      new Response("x".repeat(64), {
        status: 500,
        headers: { "content-type": "text/plain", "content-length": "64" },
      }),
      { requestedUrl: URL_UNDER_TEST, maxBufferBytes: 8 },
    );
    const result = await classify(over);
    expect(result.kind).toBe("http-error");
    if (result.kind !== "http-error") return;
    expect(result.bodyPreview).toBe("");
  });

  it("leaves a 404 with no body as http-error rather than an exception", async () => {
    const result = await classify(envelope(null, { status: 404 }));
    expect(result.kind).toBe("http-error");
  });

  // C18. `fetch` follows a redirect itself, so a 3xx that reaches the
  // classifier is one it did not follow, and carries no answer.
  it.each([300, 304, 307])("calls an unfollowed %i http-error, not ok (C18)", async (status) => {
    const result = await classify(
      envelope(status === 304 ? null : "{}", {
        status,
        headers: { "content-type": "application/json", location: "https://example.org/other" },
      }),
    );
    expect(result.kind).toBe("http-error");
  });

  it("calls a status 0 (an opaque response) http-error, with an empty preview (C18)", async () => {
    // What `redirect: "manual"` and `mode: "no-cors"` hand back: status 0, no
    // headers, no readable body.
    const result = await classify(
      createEnvelope(Response.error(), { requestedUrl: URL_UNDER_TEST }),
    );
    expect(result.kind).toBe("http-error");
    if (result.kind !== "http-error") return;
    expect(result.bodyPreview).toBe("");
    expect(result.envelope.url).toBe(URL_UNDER_TEST);
  });

  it("still reads a problem document sent with a 3xx as an exception", async () => {
    const result = await classify(json({ title: "Moved, and broken" }, { status: 300 }));
    expect(result.kind).toBe("exception");
  });

  it.each([200, 201, 202, 204, 299])("calls a %i with no problem document ok", async (status) => {
    const result = await classify(envelope(status === 204 ? null : "{}", { status }));
    expect(result.kind).toBe("ok");
  });
});

describe("classify — an abort while the body is arriving", () => {
  it("lets the abort through, rather than reading it as no problem document", async () => {
    const controller = new AbortController();
    const envelope = createEnvelope(
      stalledBody(controller.signal, "application/problem+json", 400),
      {
        requestedUrl: "https://service.test/x",
        signal: controller.signal,
      },
    );
    const classifying = classify(envelope);
    controller.abort();

    await expect(classifying).rejects.toBeInstanceOf(AbortError);
  });
});

describe("requireOk", () => {
  it("returns the envelope when the outcome is ok", async () => {
    const input = envelope("{}", { status: 200, headers: { "content-type": "application/json" } });
    await expect(requireOk(input)).resolves.toBe(input);
  });

  it("throws a ProcessesError carrying the problem, status, URL and envelope", async () => {
    const input = json(
      { type: "urn:x:no-such-process", title: "No such process" },
      { status: 404 },
    );
    const error = await requireOk(input).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProcessesError);
    if (!(error instanceof ProcessesError)) return;
    expect(error.outcome).toBe("exception");
    expect(error.status).toBe(404);
    expect(error.url).toBe(URL_UNDER_TEST);
    expect(error.problem?.type).toBe("urn:x:no-such-process");
    expect(error.envelope).toBe(input);
    expect(error.message).toContain("No such process");
  });

  it("flags a body that contradicts the wire status in its message", async () => {
    const input = json({ title: "Not found", status: 404 }, { status: 200 });
    const error = await requireOk(input).catch((err: unknown) => err);
    expect((error as Error).message).toContain("body claims status 404");
  });

  it("throws for a redirect fetch did not follow, rather than returning it (C18)", async () => {
    const error = await requireOk(envelope(null, { status: 304 })).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProcessesError);
    if (!(error instanceof ProcessesError)) return;
    expect(error.outcome).toBe("http-error");
    expect(error.status).toBe(304);
  });

  it("throws for an http-error, carrying the preview and no problem", async () => {
    const input = envelope("<h1>nope</h1>", {
      status: 503,
      headers: { "content-type": "text/html" },
    });
    const error = await requireOk(input).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProcessesError);
    if (!(error instanceof ProcessesError)) return;
    expect(error.outcome).toBe("http-error");
    expect(error.problem).toBeUndefined();
    expect(error.bodyPreview).toBe("<h1>nope</h1>");
  });
});
