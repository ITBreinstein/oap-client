import { describe, expect, it } from "vitest";
import { createRelayClient, RelayError } from "../../src/relay/relay-client.js";

describe("createRelayClient().execute", () => {
  it("asks for an asynchronous execute, so a read-route endpoint does not answer it raw", async () => {
    const sent: Headers[] = [];
    const client = createRelayClient("http://relay.test", (_input, init) => {
      sent.push(new Headers(init?.headers));
      return Promise.resolve(
        Response.json({
          upstream: {
            status: 201,
            location: "http://ogc.test/jobs/1",
            contentType: "application/json",
            preferenceApplied: "respond-async",
            body: "{}",
          },
          registration: null,
        }),
      );
    });

    await client.execute("zoo", "echo", "{}", undefined);

    expect(sent[0]?.get("Prefer")).toBe("respond-async");
  });

  it("hands back the server's own answer, raw, when the relay marks it so — a 200 included", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    const client = createRelayClient("http://relay.test", () =>
      Promise.resolve(
        new Response(png, {
          status: 200,
          headers: { "Content-Type": "image/png", "X-Relay": "1", "X-Relay-Raw": "1" },
        }),
      ),
    );

    const answer = await client.execute("zoo", "render", "{}", undefined);

    if (!("raw" in answer)) throw new Error("expected the raw answer");
    expect(answer.raw.status).toBe(200);
    expect(new Uint8Array(await answer.raw.arrayBuffer())).toEqual(png);
  });

  it("takes a server's refusal passed on raw for the server's answer, not the relay's refusal", async () => {
    const client = createRelayClient("http://relay.test", () =>
      Promise.resolve(
        new Response('{"title":"no such input"}', {
          status: 400,
          headers: {
            "Content-Type": "application/problem+json",
            "X-Relay": "1",
            "X-Relay-Raw": "1",
          },
        }),
      ),
    );

    const answer = await client.execute("zoo", "render", "{}", undefined);

    expect("raw" in answer && answer.raw.status).toBe(400);
  });
});

/** The relay's own refusal, as `problem()` in apps/relay/src/app.ts sends it. */
function relayRefusal(
  status: number,
  code: string,
  detail: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: "Refused", status, detail }), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
      "X-Relay": "1",
      "X-Relay-Error": code,
      ...headers,
    },
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<RelayError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RelayError) return error;
    throw error;
  }
  throw new Error("expected a RelayError");
}

describe("the relay's refusal codes, from the header first", () => {
  it("an execute keeps registration-capacity, not the sentence in the body", async () => {
    const client = createRelayClient("http://relay.test", () =>
      Promise.resolve(
        relayRefusal(429, "registration-capacity", "registration capacity for this session"),
      ),
    );
    const error = await refusalOf(client.execute("zoo", "echo", "{}", "token"));
    expect(error).toMatchObject({
      status: 429,
      code: "registration-capacity",
      beforeUpstream: true,
      retryAfterSeconds: undefined,
    });
  });

  it("an execute keeps rate-limited and its Retry-After", async () => {
    const client = createRelayClient("http://relay.test", () =>
      Promise.resolve(
        relayRefusal(429, "rate-limited-endpoint", "too many", { "Retry-After": "12" }),
      ),
    );
    const error = await refusalOf(client.execute("zoo", "echo", "{}", undefined));
    expect(error).toMatchObject({
      code: "rate-limited-endpoint",
      beforeUpstream: true,
      retryAfterSeconds: 12,
    });
  });

  it("an execute without the header falls back to the body's reason, then the status", async () => {
    const withReason = createRelayClient("http://relay.test", () =>
      Promise.resolve(Response.json({ reason: "timeout" }, { status: 502 })),
    );
    expect((await refusalOf(withReason.execute("zoo", "echo", "{}", undefined))).code).toBe(
      "timeout",
    );
    const bare = createRelayClient("http://relay.test", () =>
      Promise.resolve(new Response(null, { status: 504 })),
    );
    expect((await refusalOf(bare.execute("zoo", "echo", "{}", undefined))).code).toBe("504");
  });

  it("a session refused for its rate keeps the code and Retry-After", async () => {
    const client = createRelayClient("http://relay.test", () =>
      Promise.resolve(relayRefusal(429, "rate-limited", "too many", { "Retry-After": "6" })),
    );
    expect(await refusalOf(client.createSession())).toMatchObject({
      status: 429,
      code: "rate-limited",
      retryAfterSeconds: 6,
    });
  });

  it("a session or endpoint list refused without the header still says which call it was", async () => {
    const client = createRelayClient("http://relay.test", () =>
      Promise.resolve(new Response(null, { status: 502 })),
    );
    expect((await refusalOf(client.createSession())).code).toBe("session");
    expect((await refusalOf(client.endpoints())).code).toBe("endpoints");
  });

  it("ignores a Retry-After that is not whole seconds", async () => {
    const client = createRelayClient("http://relay.test", () =>
      Promise.resolve(
        relayRefusal(429, "rate-limited", "too many", {
          "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT",
        }),
      ),
    );
    expect((await refusalOf(client.createSession())).retryAfterSeconds).toBeUndefined();
  });
});
