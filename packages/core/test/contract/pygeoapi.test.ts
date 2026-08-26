/**
 * Contract tests against the reference server: pygeoapi 0.21.0, pinned in
 * infra/compose/pygeoapi.yml.
 *
 * These are the tests that catch what a fake cannot — that a real server sends
 * an absolute Location, that its exception bodies are shaped the way we read
 * them, that a non-JSON output survives the envelope. Every expectation here
 * was derived from what the running server actually sends, not from the spec.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "../../src/index.js";
import { classify, requireOk } from "../../src/http/classify.js";
import { ProcessesError } from "../../src/http/errors.js";
import { send } from "../../src/http/transport.js";

// Ports come from infra/compose/pygeoapi.yml. 5081 is the same server with CORS
// off; from Node that changes nothing, which is itself worth pinning down.
const CORS = "http://localhost:5080";
const NOCORS = "http://localhost:5081";

let client: Client;

beforeAll(async () => {
  client = createClient({ baseUrl: CORS });
  try {
    await send(CORS, { signal: AbortSignal.timeout(5000) });
  } catch (cause) {
    throw new Error(
      `pygeoapi is not answering on ${CORS}. Start it with:\n` +
        `  docker compose -f infra/compose/pygeoapi.yml up -d --wait`,
      { cause },
    );
  }
});

describe("async execution", () => {
  it("returns 201 with an absolute Location that resolves to a job document", async () => {
    const execution = await client.send("processes/hello-world/execution", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "respond-async" },
      body: JSON.stringify({ inputs: { name: "World" } }),
    });

    expect(execution.status).toBe(201);
    expect(execution.headers.get("preference-applied")).toBe("respond-async");

    // pygeoapi sends an absolute Location. The envelope resolves either form
    // against the final URL, so `location` is absolute regardless.
    expect(execution.location).toBeDefined();
    expect(execution.location?.startsWith("http://")).toBe(true);
    expect(execution.locationRaw).toBe(execution.location);

    const job = await requireOk(await send(execution.location ?? ""));
    expect(job.status).toBe(200);
    expect(job.isJson).toBe(true);

    const document = (await job.json()) as Record<string, unknown>;
    expect(document["jobID"]).toEqual(expect.any(String));
    expect(document["processID"]).toBe("hello-world");
    expect(document["status"]).toEqual(expect.any(String));

    // The job document's own `type` is "process" — the collision that makes a
    // bare type-or-title check the wrong problem-document test.
    expect(document["type"]).toBe("process");
    await expect(classify(await send(execution.location ?? ""))).resolves.toHaveProperty(
      "kind",
      "ok",
    );
  });
});

describe("a non-JSON representation", () => {
  it("keeps its media type and produces a non-empty blob", async () => {
    // hello-world only emits JSON, so the HTML representation of a resource is
    // what stands in for a non-JSON output here.
    const env = await client.send("?f=html");

    expect(env.status).toBe(200);
    expect(env.mediaType).toBe("text/html");
    expect(env.isJson).toBe(false);

    const blob = await env.blob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("text/html");
    // Read-once holds across reader kinds against a real streamed body too.
    await expect(env.text()).resolves.toContain("<!doctype html>");
  });
});

describe("a bad process id", () => {
  it("classifies as an exception with a populated type, and requireOk throws", async () => {
    const env = await client.send("processes/does-not-exist");
    expect(env.status).toBe(404);

    const result = await classify(env);
    expect(result.kind).toBe("exception");
    if (result.kind !== "exception") return;

    expect(result.problem.type).toBe("NoSuchProcess");
    // pygeoapi's own members are preserved rather than discarded.
    expect(result.problem.extensions["code"]).toBe("NoSuchProcess");

    const error = await requireOk(env).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProcessesError);
    if (!(error instanceof ProcessesError)) return;
    expect(error.outcome).toBe("exception");
    expect(error.status).toBe(404);
    expect(error.url).toBe(`${CORS}/processes/does-not-exist`);
    expect(error.problem?.type).toBe("NoSuchProcess");
  });
});

describe("the transport", () => {
  it("does not throw on a 404 — that is the classifier's call", async () => {
    await expect(client.send("processes/does-not-exist")).resolves.toHaveProperty("status", 404);
  });

  it("reaches the CORS-disabled instance identically from Node", async () => {
    // No page origin off-browser, so no preflight and nothing to block. The
    // CORS difference between 5080 and 5081 is a browser story only — which is
    // why TransportError records `crossOrigin` rather than diagnosing.
    const env = await send(`${NOCORS}/processes`);
    expect(env.status).toBe(200);
    expect(env.isJson).toBe(true);
    expect(env.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("raises a TransportError, not a ProcessesError, when nothing answers", async () => {
    // Port 1 is reserved and never listening.
    const error = await send("http://localhost:1/processes").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("TransportError");
  });
});
