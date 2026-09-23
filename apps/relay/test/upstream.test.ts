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
import { postExecute, UpstreamError, type Schedule } from "../src/upstream.js";

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
  callbacks: false,
  // msw answers before any lookup happens; see the file comment.
  allowPrivateNetwork: true,
};

const options = { timeoutMs: 5_000, maxResponseBytes: 1_024 };

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
