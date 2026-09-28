/**
 * SSRF matrix D: DNS rebinding — the time between checking an address and
 * using it.
 *
 * The relay has no such time. It never resolves a name ahead of connecting:
 * the check runs inside the socket's own `lookup`, on a fresh socket per
 * request and per hop, so the answer that was checked is the answer that is
 * dialled. These tests pin that, in two ways:
 *
 * - through `dialStub`, which wraps the real guard: a name that first answers
 *   public and then loopback gets its second connection refused;
 * - through the relay's *default* lookup, with only the resolver injected: a
 *   name answering loopback gets no connection to the loopback stub, and the
 *   resolver is asked exactly once. A pre-check followed by a separate,
 *   unguarded connect would need a second resolution and would reach the stub.
 *
 * The asynchronous execute has no lookup seam, so it is tested the second way
 * only; its connect path is the same `agent: false` + guarded `lookup` as the
 * read route's.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { forward, type ForwardRequest } from "../../src/forward.js";
import { postExecute } from "../../src/upstream.js";
import {
  dialStub,
  failure,
  never,
  publicEndpoint,
  stubServer,
  table,
  type Answers,
  type Stub,
} from "./fixtures.js";

let stub: Stub;
beforeAll(async () => {
  stub = await stubServer();
});
afterEach(() => {
  stub.reset();
});
afterAll(async () => {
  await stub.close();
});

const HOST = "rebind.example";
const base = (): string => `http://${HOST}:${String(stub.port)}/ogc`;
const limits = { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: never };
const get = (path: string): ForwardRequest => ({
  method: "GET",
  url: new URL(`${base()}${path}`),
  headers: new Headers(),
});

/** Public on the first question, loopback from then on. */
const rebinding: Answers = (call) => (call === 1 ? ["93.184.215.14"] : ["127.0.0.1"]);

describe("D1 — first answer public, second loopback", () => {
  it("a redirect hop under the base is refused when the name has rebound", async () => {
    stub.on("/ogc/d1", (_request, response) => {
      response.writeHead(302, { Location: "/ogc/d1-next" }).end();
    });
    stub.on("/ogc/d1-next", (_request, response) => {
      response.writeHead(200).end("reached loopback");
    });
    const resolved: string[] = [];
    const reason = await failure(
      forward(publicEndpoint(base()), get("/d1"), {
        ...limits,
        lookup: dialStub(table({ [HOST]: rebinding }, resolved)),
      }),
    );
    expect(reason).toBe("blocked-address");
    expect(resolved).toEqual([HOST, HOST]);
    expect(stub.requests.map((r) => r.url)).toEqual(["/ogc/d1"]);
  });

  it("the next read is refused when the name has rebound", async () => {
    stub.on("/ogc/d1", (_request, response) => {
      response.writeHead(200).end("{}");
    });
    const lookup = dialStub(table({ [HOST]: rebinding }));

    const first = await forward(publicEndpoint(base()), get("/d1"), { ...limits, lookup });
    expect(await new Response(first.body).text()).toBe("{}");

    const reason = await failure(
      forward(publicEndpoint(base()), get("/d1"), { ...limits, lookup }),
    );
    expect(reason).toBe("blocked-address");
    expect(stub.requests).toHaveLength(1);
  });

  it("the default lookup resolves once, at connect time, and never dials loopback", async () => {
    const resolved: string[] = [];
    const reason = await failure(
      forward(publicEndpoint(base()), get("/d1"), {
        ...limits,
        resolve: table({ [HOST]: ["127.0.0.1"] }, resolved),
      }),
    );
    expect(reason).toBe("blocked-address");
    expect(resolved).toEqual([HOST]);
    expect(stub.connections).toBe(0);
  });

  it("the asynchronous execute: likewise", async () => {
    const resolved: string[] = [];
    const reason = await failure(
      postExecute(publicEndpoint(base()), "p", "{}", {
        ...limits,
        resolve: table({ [HOST]: ["127.0.0.1"] }, resolved),
      }),
    );
    expect(reason).toBe("blocked-address");
    expect(resolved).toEqual([HOST]);
    expect(stub.connections).toBe(0);
  });
});

describe("D2 — public and private answers mixed", () => {
  it.each([
    [["93.184.215.14", "::1"]],
    [["93.184.215.14", "fd00::1"]],
    [["fe80::1", "93.184.215.14"]],
    [["::1"]],
  ])("%j: the read route refuses the name, and the stub sees nothing", async (addresses) => {
    const reason = await failure(
      forward(publicEndpoint(base()), get("/d2"), {
        ...limits,
        resolve: table({ [HOST]: addresses }),
      }),
    );
    expect(reason).toBe("blocked-address");
    expect(stub.connections).toBe(0);
  });

  it.each([[["93.184.215.14", "::1"]], [["93.184.215.14", "fd00::1"]], [["::1"]]])(
    "%j: the asynchronous execute refuses the name, and the stub sees nothing",
    async (addresses) => {
      const reason = await failure(
        postExecute(publicEndpoint(base()), "p", "{}", {
          ...limits,
          resolve: table({ [HOST]: addresses }),
        }),
      );
      expect(reason).toBe("blocked-address");
      expect(stub.connections).toBe(0);
    },
  );
});
