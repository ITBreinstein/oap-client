/**
 * The relay's one outbound request. msw intercepts `node:http` below the
 * socket, so nothing here touches a network — which also means the
 * connect-time address check cannot run under it. That check is exercised on
 * its own in `upstream-lookup.test.ts`.
 */

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EndpointConfig } from "../src/config.js";
import { UpstreamError, type Schedule } from "../src/exchange.js";
import type { ForwardedResponse } from "../src/forward.js";
import { postExecute, type ExecuteAnswer } from "../src/upstream.js";

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const endpoint: EndpointConfig = {
  key: "ogc",
  baseUrl: "http://ogc.example/api",
  executeRoute: "relay",
  readRoute: "direct",
  callbacks: false,
  // msw answers before any lookup happens; see the file comment.
  allowPrivateNetwork: true,
};

const options = { timeoutMs: 5_000, maxResponseBytes: 1_024 };

/** The raw answer, or a failed test: the job arm has no stream to read. */
function raw(answer: ExecuteAnswer): ForwardedResponse {
  if (!("raw" in answer)) throw new Error(`expected a raw answer, got ${String(answer.status)}`);
  return answer.raw;
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpstreamError) return error.reason;
    throw error;
  }
  throw new Error("expected the exchange to fail");
}

describe("postExecute", () => {
  it("sends a fixed POST and hands back what the browser could not read", async () => {
    let seen:
      { method: string; url: string; headers: [string, string][]; body: string } | undefined;
    server.use(
      http.post("http://ogc.example/api/processes/:id/execution", async ({ request }) => {
        seen = {
          method: request.method,
          url: request.url,
          headers: [...request.headers.entries()],
          body: await request.text(),
        };
        return new HttpResponse("null", {
          status: 201,
          headers: {
            Location: "http://ogc.example/api/jobs/42",
            "Content-Type": "application/json",
            "Preference-Applied": "respond-async",
            "Set-Cookie": "session=abc",
          },
        });
      }),
    );

    const response = await postExecute(endpoint, "OTB.BandMath", '{"inputs":{}}', options);

    expect(response).toEqual({
      status: 201,
      location: "http://ogc.example/api/jobs/42",
      contentType: "application/json",
      preferenceApplied: "respond-async",
      body: "null",
    });
    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe("http://ogc.example/api/processes/OTB.BandMath/execution");
    expect(seen?.body).toBe('{"inputs":{}}');
    // Exactly these, and nothing a browser could have smuggled in. Node adds
    // `Connection: close` itself, because the request uses no pooled agent.
    const names = (seen?.headers ?? []).map(([name]) => name).sort();
    expect(names).toEqual([
      "accept",
      "connection",
      "content-length",
      "content-type",
      "host",
      "prefer",
      "user-agent",
    ]);
  });

  it("percent-encodes the process id into its own path segment", async () => {
    let url = "";
    server.use(
      http.post("http://ogc.example/*", ({ request }) => {
        url = request.url;
        return new HttpResponse(null, { status: 400 });
      }),
    );
    await postExecute(endpoint, "a b", "{}", options);
    expect(url).toBe("http://ogc.example/api/processes/a%20b/execution");
  });

  it("follows no redirect, so no hop is ever unvalidated", async () => {
    let followed = false;
    server.use(
      http.post("http://ogc.example/api/processes/p/execution", () =>
        HttpResponse.redirect("http://169.254.169.254/latest/meta-data/", 307),
      ),
      http.all("http://169.254.169.254/*", () => {
        followed = true;
        return new HttpResponse("secret");
      }),
    );
    expect(await failure(postExecute(endpoint, "p", "{}", options))).toBe("redirect-refused");
    expect(followed).toBe(false);
  });

  it("refuses a response that declares more than the cap", async () => {
    server.use(
      http.post(
        "http://ogc.example/*",
        () =>
          new HttpResponse("x".repeat(2_048), {
            status: 201,
            headers: { "Content-Length": "2048" },
          }),
      ),
    );
    expect(await failure(postExecute(endpoint, "p", "{}", options))).toBe("response-too-large");
  });

  it("stops reading a response that streams past the cap without declaring it", async () => {
    server.use(
      http.post("http://ogc.example/*", () => {
        const chunk = new TextEncoder().encode("x".repeat(512));
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < 8; i += 1) controller.enqueue(chunk);
            controller.close();
          },
        });
        return new HttpResponse(body, { status: 201 });
      }),
    );
    expect(await failure(postExecute(endpoint, "p", "{}", options))).toBe("response-too-large");
  });

  it("gives up at the deadline", async () => {
    let fire: (() => void) | undefined;
    const schedule: Schedule = (callback) => {
      fire = callback;
      return () => undefined;
    };
    let release = (): void => undefined;
    let arrived = (): void => undefined;
    const reached = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    server.use(
      http.post("http://ogc.example/*", async () => {
        arrived();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const pending = failure(postExecute(endpoint, "p", "{}", { ...options, schedule }));
    // Once the server is holding the request, let the deadline pass.
    await reached;
    fire?.();
    expect(await pending).toBe("timeout");
    release();
  });

  it("reports a connection failure as a code, not a message", async () => {
    server.use(http.post("http://ogc.example/*", () => HttpResponse.error()));
    expect(await failure(postExecute(endpoint, "p", "{}", options))).toBe("connection-failed");
  });

  it.each([
    ["the metadata address", "http://169.254.169.254"],
    ["loopback", "http://127.0.0.1:5080"],
    ["localhost", "http://localhost:5080"],
    ["a mapped private address", "http://[::ffff:10.0.0.1]"],
  ])("refuses %s before sending anything, unless the endpoint allows it", async (_, baseUrl) => {
    let reached = false;
    server.use(
      http.all("*", () => {
        reached = true;
        return new HttpResponse(null, { status: 201 });
      }),
    );
    const guarded: EndpointConfig = { ...endpoint, baseUrl, allowPrivateNetwork: false };
    expect(await failure(postExecute(guarded, "p", "{}", options))).toBe("blocked-address");
    expect(reached).toBe(false);
  });
});

describe("postExecute — an answer that is not a job (finding 0059, review R7)", () => {
  // The first bytes of a PNG: not valid UTF-8, so a text round trip would show.
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80,
  ]);

  it("hands a synchronous result back raw, byte for byte, with the evidence headers only", async () => {
    server.use(
      http.post(
        "http://ogc.example/*",
        () =>
          new HttpResponse(PNG, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Preference-Applied": "wait",
              "Set-Cookie": "session=abc",
            },
          }),
      ),
    );
    const answer = raw(await postExecute(endpoint, "p", "{}", options));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("image/png");
    expect(answer.headers.get("preference-applied")).toBe("wait");
    expect(answer.headers.get("set-cookie")).toBeNull();
    expect(new Uint8Array(await new Response(answer.body).arrayBuffer())).toEqual(PNG);
    await expect(answer.done).resolves.toEqual({ bytes: PNG.byteLength, capHit: undefined });
  });

  it("hands back a result over the job cap whole, under the raw cap", async () => {
    const result = JSON.stringify({ value: "x".repeat(300 * 1024) });
    server.use(
      http.post(
        "http://ogc.example/*",
        () => new HttpResponse(result, { headers: { "Content-Type": "application/json" } }),
      ),
    );
    const answer = raw(
      await postExecute(endpoint, "p", "{}", { ...options, maxRawResponseBytes: 1024 * 1024 }),
    );
    expect(await new Response(answer.body).text()).toBe(result);
  });

  it("hands a refusal back raw, as the server sent it", async () => {
    const problem = '{"type":"about:blank","title":"no such input"}';
    server.use(
      http.post(
        "http://ogc.example/*",
        () =>
          new HttpResponse(problem, {
            status: 400,
            headers: { "Content-Type": "application/problem+json" },
          }),
      ),
    );
    const answer = raw(await postExecute(endpoint, "p", "{}", options));
    expect(answer.status).toBe(400);
    expect(await new Response(answer.body).text()).toBe(problem);
  });

  it("refuses a raw answer that declares more than the raw cap", async () => {
    server.use(
      http.post(
        "http://ogc.example/*",
        () => new HttpResponse("x".repeat(2_048), { headers: { "Content-Length": "2048" } }),
      ),
    );
    expect(
      await failure(postExecute(endpoint, "p", "{}", { ...options, maxRawResponseBytes: 1_024 })),
    ).toBe("response-too-large");
  });

  it("keeps the deadline on a raw body still streaming, and cancels it once the body is done", async () => {
    let fire: () => void = () => undefined;
    let cancelled = 0;
    const schedule: Schedule = (callback) => {
      fire = callback;
      return () => {
        cancelled += 1;
      };
    };
    server.use(
      http.post("http://ogc.example/api/processes/trickle/execution", () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("first chunk"));
          },
        });
        return new HttpResponse(body, { status: 200 });
      }),
      http.post(
        "http://ogc.example/api/processes/whole/execution",
        () => new HttpResponse("all of it", { status: 200 }),
      ),
    );

    const trickle = raw(await postExecute(endpoint, "trickle", "{}", { ...options, schedule }));
    expect(cancelled).toBe(0);
    const text = new Response(trickle.body).text();
    fire();
    await expect(text).rejects.toThrow();
    await expect(trickle.done).resolves.toMatchObject({ capHit: "duration" });

    cancelled = 0;
    const whole = raw(await postExecute(endpoint, "whole", "{}", { ...options, schedule }));
    expect(await new Response(whole.body).text()).toBe("all of it");
    await whole.done;
    expect(cancelled).toBe(1);
  });
});
