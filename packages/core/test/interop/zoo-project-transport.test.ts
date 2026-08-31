/**
 * The transport boundary against ZOO-Project.
 *
 * Everything below `classify()` — envelopes, media types, Link headers, problem
 * documents — was written and validated against pygeoapi. This file re-runs
 * that logic against an implementation that has nothing in common with it, to
 * find the places where "works" meant "works against the one server we had".
 *
 * Reports, never blocks; skips when the stack is down. `./infra/zoo/zoo.sh up`.
 */

import { describe, expect, it } from "vitest";
import landingFixture from "../fixtures/zoo-project/landing-page.json" with { type: "json" };
import { BodyTooLargeError } from "../../src/http/errors.js";
import { classify, requireOk } from "../../src/http/classify.js";
import { collectLinks, readBodyLinks } from "../../src/links/resolve.js";
import { isJsonMediaType } from "../../src/http/media-type.js";
import { send } from "../../src/http/transport.js";
import { LANDING, ZOO, answering } from "./zoo.js";

const zooUp = await answering();

describe.skipIf(!zooUp)("media types", () => {
  it("parses the charset parameter off every response", async () => {
    // ZOO sends `application/json;charset=UTF-8` everywhere. pygeoapi sends a
    // bare `application/json`, so the parameter-stripping path in
    // parseMediaType has never been exercised against a live server until now.
    const landing = await send(LANDING, { headers: { Accept: "application/json" } });

    expect(landing.mediaType).toBe("application/json");
    expect(landing.mediaTypeParams["charset"]).toBe("UTF-8");
    expect(landing.isJson).toBe(true);
  });

  it("treats the OpenAPI +json structured suffix as JSON", async () => {
    // `application/vnd.oai.openapi+json;version=3.0;charset=UTF-8` — a vendor
    // tree, a structured suffix and two parameters. A client matching
    // `=== "application/json"` would refuse to read this server's own API
    // description, which is the document it needs to generate forms from.
    const api = await send(`${ZOO}/api`, { headers: { Accept: "application/json" } });

    expect(api.status).toBe(200);
    expect(api.mediaType).toBe("application/vnd.oai.openapi+json");
    expect(api.mediaTypeParams["version"]).toBe("3.0");
    expect(api.isJson).toBe(true);
    expect(isJsonMediaType(api.mediaType)).toBe(true);
    await expect(api.json()).resolves.toHaveProperty("components");
  });
});

describe.skipIf(!zooUp)("Link headers", () => {
  it("carries body links and a header link on the same response, and merges both", async () => {
    // pygeoapi sends no Link header at all, so `collectLinks` merging header
    // with body has been dead code against every live server we had. ZOO sends
    // a `rel="profile"` header on /processes, /processes/{id} and /jobs — and
    // none on the landing page — so both halves of the merge run here.
    const process = await send(`${ZOO}/processes/echo`, {
      headers: { Accept: "application/json" },
    });

    expect(process.links.map((link) => link.rel)).toContain("profile");

    const merged = collectLinks(process, readBodyLinks(await process.json()));
    const rels = merged.map((link) => link.rel);

    // The header link and both body links, all three, all absolute.
    expect(rels).toContain("profile");
    expect(rels).toContain("http://www.opengis.net/def/rel/ogc/1.0/execute");
    expect(rels).toContain("alternate");
    expect(merged.find((link) => link.rel === "profile")?.href).toBe(
      "https://www.opengis.net/dev/profile/OGC/0/ogc-process-description",
    );

    // And no `self`. A client that wants to re-fetch or cache-key the
    // description it is holding has to rebuild the URL it came from, which is
    // the one thing this layer exists to avoid. Finding 0017.
    expect(rels).not.toContain("self");
  });

  it("sends no Link header on the landing page, where the body carries everything", async () => {
    const landing = await send(LANDING, { headers: { Accept: "application/json" } });

    expect(landing.links).toEqual([]);
    const merged = collectLinks(landing, readBodyLinks(await landing.json()));
    expect(merged).toHaveLength(landingFixture.links.length);
  });
});

describe.skipIf(!zooUp)("exceptions", () => {
  it("returns a real problem document on 404, which pygeoapi does not", async () => {
    // The direct counterpart of finding 0001. pygeoapi answers an unknown
    // process with `{code, description}` — not RFC 7807 at all. ZOO answers
    // with `type`/`title`/`detail`, and the `type` is the registered OGC
    // exception URI. The client's problem parsing needed no change for either,
    // which is the point of testing it against both.
    const missing = await send(`${ZOO}/processes/does-not-exist`, {
      headers: { Accept: "application/json" },
    });

    expect(missing.status).toBe(404);

    const classified = await classify(missing);
    expect(classified.kind).toBe("exception");
    if (classified.kind !== "exception") return;

    expect(classified.problem.type).toBe(
      "http://www.opengis.net/def/exceptions/ogcapi-processes-1/1.0/no-such-process",
    );
    expect(classified.problem.title).toBe("NoSuchProcess");
    expect(classified.problem.detail).toBeDefined();
  });

  it("never declares application/problem+json, so detection rests on the status", async () => {
    // `declared` is the strongest signal `looksLikeProblem` has and neither
    // server ever sets it. Against ZOO every exception is plain
    // `application/json`, so the only reason these are recognised is that the
    // wire status is already >= 400 — which is exactly the branch that cannot
    // catch a problem document served with a 200. Finding 0013.
    const missing = await send(`${ZOO}/processes/does-not-exist`, {
      headers: { Accept: "application/json" },
    });

    expect(missing.mediaType).toBe("application/json");
    expect(missing.mediaType).not.toBe("application/problem+json");
  });

  it("writes a bare token as `type` on every exception but one", async () => {
    // RFC 7807 §3.1 makes `type` a URI reference. ZOO gets it right for
    // NoSuchProcess and wrong everywhere else — `"type": "InvalidMethod"`,
    // `"type": "BadRequest"`. The client keeps them verbatim rather than
    // rejecting the document, so the exception still reaches the user; a client
    // that dereferenced `type` would not. Finding 0013.
    const wrongMethod = await send(LANDING, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(wrongMethod.status).toBe(405);
    const classified = await classify(wrongMethod);
    expect(classified.kind).toBe("exception");
    if (classified.kind !== "exception") return;

    expect(classified.problem.type).toBe("InvalidMethod");
    expect(classified.problem.type.startsWith("http")).toBe(false);
  });

  it("omits the Allow header on 405, which RFC 9110 requires", async () => {
    // Finding 0013. Nothing in the client reads Allow today, but a capability
    // probe is the obvious consumer: "which methods does this job endpoint
    // support" is answerable from one 405 on a conformant server and needs a
    // request per method here.
    const wrongMethod = await send(LANDING, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBeNull();
  });

  it("answers an unknown path with 400 rather than 404", async () => {
    // This one bites the client's own design. Capability probing — send the
    // request, do not trust the conformance document — depends on telling "this
    // endpoint is not here" apart from "your request was malformed". ZOO
    // reports both as 400. Finding 0014.
    const nonsense = await send(`${ZOO}/nonsense`, { headers: { Accept: "application/json" } });

    expect(nonsense.status).toBe(400);
    await expect(nonsense.json()).resolves.toMatchObject({ title: "BadRequest" });
  });
});

describe.skipIf(!zooUp)("the 200 bodies are not mistaken for problem documents", () => {
  it("classifies the landing page and a process description as ok", async () => {
    // `looksLikeProblem` deliberately does not test for "has a title", because
    // every landing page and process description has one. Both of these carry a
    // `title` and no `type`, at status 200. If the heuristic were the obvious
    // one, discovery against this server would report two exceptions.
    const landing = await send(LANDING, { headers: { Accept: "application/json" } });
    await expect(classify(landing)).resolves.toHaveProperty("kind", "ok");

    const process = await send(`${ZOO}/processes/echo`, {
      headers: { Accept: "application/json" },
    });
    await expect(classify(process)).resolves.toHaveProperty("kind", "ok");
    await expect(requireOk(process)).resolves.toBeDefined();
  });

  it("does not collide the way pygeoapi's job document does", async () => {
    // Finding 0003 is pygeoapi serving `{"type": "process"}` on a job — a
    // URI-shaped-looking `type` on a 200. ZOO's 200 bodies carry no top-level
    // `type` at all, so the collision cannot arise here. Recorded because "no
    // collision" is a matrix cell too.
    const jobs = await send(`${ZOO}/jobs`, { headers: { Accept: "application/json" } });
    const body = await jobs.json();

    expect(body).not.toHaveProperty("type");
    await expect(classify(jobs)).resolves.toHaveProperty("kind", "ok");
  });
});

describe.skipIf(!zooUp)("body buffering", () => {
  it("refuses to buffer the full process list under a low limit, and still hands back a blob", async () => {
    // 703 processes, ~630 kB — the first live response big enough to exercise
    // the limit at all. pygeoapi's reference configuration serves four.
    const capped = await send(`${ZOO}/processes`, {
      headers: { Accept: "application/json" },
      maxBufferBytes: 64 * 1024,
    });

    expect(capped.status).toBe(200);
    expect(capped.bodyTooLarge).toBe(true);
    await expect(capped.json()).rejects.toThrow(BodyTooLargeError);
    await expect(capped.blob()).resolves.toBeInstanceOf(Blob);
  });

  it("buffers the same response under the default limit", async () => {
    const full = await send(`${ZOO}/processes`, { headers: { Accept: "application/json" } });

    expect(full.bodyTooLarge).toBe(false);
    await expect(full.json()).resolves.toHaveProperty("numberTotal", 703);
  });
});

describe.skipIf(!zooUp)("POST with an unexpected content type", () => {
  it("crashes the kernel instead of refusing the method", async () => {
    // `application/json` on a GET-only path gets a clean 405. `text/plain` on
    // the same path segfaults the ZOO kernel, which reports it as a 500 with
    // the signal number in `detail`. Finding 0015.
    //
    // This is reachable by accident, not only on purpose: `fetch(url, { method:
    // "POST", body: someString })` sets `text/plain;charset=UTF-8` by itself,
    // so a client that forgets one header does not get a 415 — it takes the
    // server process down with it.
    const clean = await send(LANDING, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(clean.status).toBe(405);

    const crash = await send(LANDING, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: "{}",
    });

    expect(crash.status).toBe(500);
    await expect(crash.json()).resolves.toMatchObject({
      title: "NoApplicableCode",
      detail: expect.stringContaining("SIGSEGV") as unknown as string,
    });

    // CGI, so the crash takes down one request rather than the server. That is
    // the only reason this is `major` and not `blocking`.
    const after = await send(LANDING, { headers: { Accept: "application/json" } });
    expect(after.status).toBe(200);
  });

  it("mislabels the crash response as `500 Not Implemented`", async () => {
    // 500 is Internal Server Error; Not Implemented is 501. The reason phrase
    // is advisory and nothing in the client reads it, but it is what a human
    // debugging from a proxy log sees first. Finding 0015.
    const crash = await send(LANDING, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });

    // `encoding` is not a media-type parameter either; the spelling is `charset`.
    expect(crash.status).toBe(500);
    expect(crash.mediaType).toBe("application/json");
    expect(crash.mediaTypeParams["charset"]).toBeUndefined();
    expect(crash.mediaTypeParams["encoding"]).toBe("utf-8");
  });
});

describe.skipIf(!zooUp)("service-level failures", () => {
  it("reports a rejected input as 500, where the fault is the request's", async () => {
    // Ahead of the execution task, but it is a transport-level observation: the
    // service says the request was missing a required input, and that arrives
    // as a 500. A client cannot tell "you asked wrongly" from "the server
    // broke", so it cannot decide whether retrying is pointless. Finding 0016.
    const rejected = await send(`${ZOO}/processes/echo/execution`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: { value: "hello" } }),
    });

    expect(rejected.status).toBe(500);
    const classified = await classify(rejected);
    expect(classified.kind).toBe("exception");
    if (classified.kind !== "exception") return;

    expect(classified.problem.title).toBe("NoApplicableCode");
    expect(classified.problem.detail).toContain("at least one input");
  });
});
