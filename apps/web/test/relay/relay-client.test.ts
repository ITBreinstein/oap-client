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
});
