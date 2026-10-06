import { describe, expect, it } from "vitest";
import { createRelayClient } from "../../src/relay/relay-client.js";

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
