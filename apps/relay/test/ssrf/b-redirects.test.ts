/**
 * SSRF matrix B: redirects from a malicious allowlisted server.
 *
 * The rule, as decided in the audit (and ADR 0001): a `GET` redirect is
 * followed by hand only while its target is still under the endpoint's base —
 * same origin, no userinfo, under the base path — at most three times, and
 * every hop goes through the address guard again. Any other redirect is not
 * followed but handed back to the browser as the server sent it, marked
 * `X-Relay` and not `X-Relay-Error`: the redirect is evidence of what the
 * server did. `POST` and `DELETE` redirects are never followed, and the
 * asynchronous execute follows none at all.
 *
 * Two stubs: `origin` plays the allowlisted server, `target` the place it
 * tries to send us. "Not followed" is asserted as zero connections to
 * `target`, observed at its socket.
 */

import type http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { forward, MAX_REDIRECTS, type ForwardRequest } from "../../src/forward.js";
import { postExecute } from "../../src/upstream.js";
import {
  browserRequest,
  dialStub,
  failure,
  never,
  publicEndpoint,
  relayConfig,
  stubServer,
  table,
  type Stub,
} from "./fixtures.js";

let origin: Stub;
let target: Stub;
beforeAll(async () => {
  origin = await stubServer();
  target = await stubServer();
});
afterEach(() => {
  origin.reset();
  target.reset();
});
afterAll(async () => {
  await origin.close();
  await target.close();
});

const HOST = "testbed.example";
const base = (): string => `http://${HOST}:${String(origin.port)}/ogc`;
const endpoint = () => publicEndpoint(base());
const limits = { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: never };

/** Public answers for every name a test uses; the guard accepts them, `dialStub` dials loopback. */
function publicDns(asked: string[] = []) {
  return table(
    {
      [HOST]: ["93.184.215.14"],
      "other.example": ["93.184.215.15"],
      "metadata.internal.example": ["169.254.169.254"],
    },
    asked,
  );
}

function get(path: string): ForwardRequest {
  return { method: "GET", url: new URL(`${base()}${path}`), headers: new Headers() };
}

function redirect(status: number, location: string) {
  return (_request: http.IncomingMessage, response: http.ServerResponse): void => {
    response.writeHead(status, { Location: location }).end();
  };
}

describe("B — redirects off the base: handed back unchanged, never followed", () => {
  it.each([
    ["B1", "the metadata address", () => "http://169.254.169.254/latest/meta-data/"],
    [
      "B1",
      "a name for the metadata address",
      () => `http://metadata.internal.example:${String(target.port)}/`,
    ],
    ["B2", "another public origin", () => `http://other.example:${String(target.port)}/x`],
    [
      "B2",
      "another origin, network-path reference",
      () => `//other.example:${String(target.port)}/x`,
    ],
    ["B2", "loopback by literal", () => `http://127.0.0.1:${String(target.port)}/`],
    ["B2", "the same host on another port", () => `http://${HOST}:${String(target.port)}/ogc/x`],
    [
      "B2",
      "the same host over another scheme",
      () => `https://${HOST}:${String(origin.port)}/ogc/x`,
    ],
    ["B2", "the same origin, outside the base path", () => "/ogc-admin/x"],
  ])("%s: %s", async (_id, _label, location) => {
    origin.on("/ogc/away", redirect(302, location()));
    const asked: string[] = [];
    const forwarded = await forward(endpoint(), get("/away"), {
      ...limits,
      lookup: dialStub(publicDns(), asked),
    });
    await new Response(forwarded.body).text();

    expect(forwarded.status).toBe(302);
    expect(forwarded.headers.get("location")).toBe(location());
    expect(forwarded.redirectsFollowed).toBe(0);
    expect(asked).toEqual([HOST]);
    expect(origin.requests.map((r) => r.url)).toEqual(["/ogc/away"]);
    expect(target.connections).toBe(0);
  });

  // `URL.origin` ignores userinfo, so this is under the base by origin alone;
  // followed, Node would send the userinfo on as `Authorization: Basic`.
  it("B2: the same origin with userinfo in the target", async () => {
    const location = `http://user:pw@${HOST}:${String(origin.port)}/ogc/landed`;
    origin.on("/ogc/away", redirect(302, location));
    origin.on("/ogc/landed", (_request, response) => {
      response.writeHead(200).end("followed");
    });
    const forwarded = await forward(endpoint(), get("/away"), {
      ...limits,
      lookup: dialStub(publicDns()),
    });
    await new Response(forwarded.body).text();

    expect(forwarded.status).toBe(302);
    expect(forwarded.redirectsFollowed).toBe(0);
    expect(origin.requests.map((r) => r.url)).toEqual(["/ogc/away"]);
    expect(origin.requests.some((r) => r.headers.authorization !== undefined)).toBe(false);
  });

  it("B3: 307 under the base is followed, then a 302 to loopback at hop 2 is handed back", async () => {
    origin.on("/ogc/b3", redirect(307, "/ogc/b3-next"));
    origin.on("/ogc/b3-next", redirect(302, `http://127.0.0.1:${String(target.port)}/`));
    const asked: string[] = [];
    const forwarded = await forward(endpoint(), get("/b3"), {
      ...limits,
      lookup: dialStub(publicDns(), asked),
    });
    await new Response(forwarded.body).text();

    expect(forwarded.status).toBe(302);
    expect(forwarded.headers.get("location")).toBe(`http://127.0.0.1:${String(target.port)}/`);
    expect(forwarded.redirectsFollowed).toBe(1);
    expect(asked).toEqual([HOST, HOST]);
    expect(target.connections).toBe(0);
  });

  it("hands the 3xx back through the app unchanged, marked X-Relay and not X-Relay-Error", async () => {
    const location = `http://other.example:${String(target.port)}/x`;
    origin.on("/ogc/away", redirect(302, location));
    const app = createApp({
      config: relayConfig([endpoint()]),
      schedule: never,
      forward: (e, request) => forward(e, request, { ...limits, lookup: dialStub(publicDns()) }),
      onAudit: () => undefined,
    });

    const response = await browserRequest(app, "/read/testbed/away");
    await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(location);
    expect(response.headers.get("X-Relay")).toBe("1");
    expect(response.headers.get("X-Relay-Error")).toBeNull();
    expect(target.connections).toBe(0);
  });
});

describe("B — redirects under the base: followed, and validated again on every hop", () => {
  it(`B4: a redirect loop is refused after ${String(MAX_REDIRECTS)} hops`, async () => {
    origin.on("/ogc/loop", redirect(307, "/ogc/loop"));
    const asked: string[] = [];
    const reason = await failure(
      forward(endpoint(), get("/loop"), { ...limits, lookup: dialStub(publicDns(), asked) }),
    );
    expect(reason).toBe("redirect-limit");
    expect(origin.requests).toHaveLength(MAX_REDIRECTS + 1);
    expect(asked).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("B5: a same-origin redirect to an allowed path is followed, through the guard and DNS again", async () => {
    origin.on("/ogc/b5", redirect(302, "/ogc/b5-landed"));
    origin.on("/ogc/b5-landed", (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
    const lookups: string[] = [];
    const resolved: string[] = [];
    const forwarded = await forward(endpoint(), get("/b5"), {
      ...limits,
      lookup: dialStub(publicDns(resolved), lookups),
    });

    expect(await new Response(forwarded.body).text()).toBe("{}");
    expect(forwarded.status).toBe(200);
    expect(forwarded.redirectsFollowed).toBe(1);
    expect(forwarded.finalUrl).toBe(`${base()}/b5-landed`);
    expect(lookups).toEqual([HOST, HOST]);
    // A fresh answer per hop, not one cached from the first.
    expect(resolved).toEqual([HOST, HOST]);
  });
});

describe("B — methods that never follow", () => {
  it.each([
    ["POST", "/processes/p/execution", "{}"],
    ["DELETE", "/jobs/9", undefined],
  ] as const)(
    "a %s redirect under the base is handed back, not followed",
    async (method, path, body) => {
      origin.on(`/ogc${path}`, redirect(307, "/ogc/elsewhere"));
      const forwarded = await forward(
        endpoint(),
        { method, url: new URL(`${base()}${path}`), headers: new Headers(), body },
        { ...limits, lookup: dialStub(publicDns()) },
      );
      await new Response(forwarded.body).text();

      expect(forwarded.status).toBe(307);
      expect(forwarded.redirectsFollowed).toBe(0);
      expect(origin.requests.map((r) => r.method)).toEqual([method]);
    },
  );

  it("the asynchronous execute follows no redirect at all", async () => {
    origin.on(
      "/ogc/processes/p/execution",
      redirect(302, `http://127.0.0.1:${String(target.port)}/`),
    );
    const reason = await failure(
      postExecute(
        // Dialled directly: this test is about redirects, not addresses.
        publicEndpoint(`http://127.0.0.1:${String(origin.port)}/ogc`, {
          allowPrivateNetwork: true,
        }),
        "p",
        "{}",
        limits,
      ),
    );
    expect(reason).toBe("redirect-refused");
    expect(target.connections).toBe(0);
  });
});
