/**
 * A callback body still uploading after the relay has answered, through the
 * real listener started with the relay's own options. The callback route
 * never reads its body; with `@hono/node-server`'s default cleanup the socket
 * was destroyed 500 ms after the answer, mid-upload (review R6). pygeoapi
 * posts a job's outputs to `successUri` and treats a reset callback
 * connection as a failure of the job (finding 0047).
 */

import { once } from "node:events";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { relayServeOptions } from "../src/serve-options.js";
import { mintSecretToken } from "../src/tokens.js";

let relay: ServerType;
let port = 0;

beforeAll(async () => {
  relay = serve({ ...relayServeOptions, fetch: createApp().fetch, port: 0, hostname: "127.0.0.1" });
  await once(relay, "listening");
  port = (relay.address() as AddressInfo).port;
});

afterAll(async () => {
  if ("closeAllConnections" in relay) relay.closeAllConnections();
  relay.close();
  await once(relay, "close").catch(() => undefined);
});

/**
 * Posts `chunks` × 256 KiB to a callback URL, one chunk every `gapMs`, the way
 * an HTTP client uploads a body before it reads the answer. Says whether the
 * whole body went out, and the status line that came back.
 */
async function slowCallback(chunks: number, gapMs: number): Promise<string> {
  const chunk = Buffer.alloc(256 * 1024, 0x20);
  const socket = net.connect(port, "127.0.0.1");
  await once(socket, "connect");
  let received = "";
  socket.on("data", (data: Buffer) => {
    received += data.toString("latin1");
  });
  const failed = new Promise<string>((resolve) => {
    socket.on("error", (error: NodeJS.ErrnoException) => {
      resolve(`connection error ${String(error.code)}`);
    });
  });
  const upload = (async (): Promise<string> => {
    socket.write(
      `POST /callbacks/${mintSecretToken()}/success HTTP/1.1\r\nHost: relay\r\n` +
        `Content-Type: application/json\r\nContent-Length: ${String(chunks * chunk.length)}\r\n\r\n`,
    );
    for (let i = 0; i < chunks; i++) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      if (socket.destroyed)
        return `socket destroyed after ${String(i)} of ${String(chunks)} chunks`;
      socket.write(chunk);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    return `body sent; answer: ${received.split("\r\n")[0] ?? "(none)"}`;
  })();
  const outcome = await Promise.race([upload, failed]);
  socket.destroy();
  return outcome;
}

it("lets a 4 MiB callback body uploaded over 0.8 s finish", async () => {
  expect(await slowCallback(16, 50)).toBe("body sent; answer: HTTP/1.1 404 Not Found");
});

it("lets the same body uploaded within 0.3 s finish", async () => {
  expect(await slowCallback(16, 15)).toBe("body sent; answer: HTTP/1.1 404 Not Found");
});
