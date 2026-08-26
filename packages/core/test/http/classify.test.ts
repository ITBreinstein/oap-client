import { describe, expect, it } from "vitest";
import { BODY_PREVIEW_LIMIT, classify, requireOk } from "../../src/http/classify.js";
import { createEnvelope } from "../../src/http/envelope.js";
import { ProcessesError } from "../../src/http/errors.js";

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

  it("ignores a non-string type or title", async () => {
    const result = await classify(json({ type: 7, title: null }, { status: 400 }));
    expect(result.kind).toBe("http-error");
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
