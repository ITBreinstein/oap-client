/**
 * The classification matrix: one test per row.
 *
 * Every row is a claim about what the core does with a response shape, and
 * three of them exist because a live server produces exactly that shape. Where
 * that is so, the server is named.
 *
 * Reduction tests this file backs:
 *  1. classify on `requestedMode` instead of on evidence → the "201 despite
 *     sync" and "200 with a job body" rows go red.
 *  2. use `Location` verbatim without resolving it → the relative-`Location`
 *     row goes red.
 *  3. remove the body-link fallback → the "201, no Location" row goes red.
 */

import { describe, expect, it } from "vitest";
import { createEnvelope } from "../../src/http/envelope.js";
import type { ResponseEnvelope } from "../../src/http/envelope.js";
import { classifyExecution, gatherEvidence } from "../../src/execution/classify-execution.js";
import { AmbiguousExecutionResponseError } from "../../src/errors.js";
import type { Execution, ExecutionMode } from "../../src/execution/types.js";

const EXECUTION_URL = "https://service.test/oapi/processes/hello-world/execution";

/**
 * A response as if it had arrived from `EXECUTION_URL`.
 *
 * `Response` has no settable `url`, so the envelope's `requestedUrl` fallback
 * supplies the base — which is the same path the transport takes for a
 * synthesised response, and is what makes the relative-`Location` row below a
 * genuine test of resolution rather than of the fixture.
 */
function envelopeOf(
  status: number,
  headers: Record<string, string>,
  body?: string,
  url = EXECUTION_URL,
): ResponseEnvelope {
  return createEnvelope(new Response(body ?? null, { status, headers }), { requestedUrl: url });
}

async function classify(
  envelope: ResponseEnvelope,
  requestedMode: ExecutionMode = "sync",
): Promise<Execution> {
  return classifyExecution(envelope, await gatherEvidence(envelope), requestedMode);
}

describe("classification matrix", () => {
  it("200, application/json, result document → immediate", async () => {
    const envelope = envelopeOf(
      200,
      { "Content-Type": "application/json" },
      '{"outputs":[{"id":"echo","value":"Hello plugfest!"}]}',
    );
    const execution = await classify(envelope);

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    // The envelope goes back whole and unparsed — T4. The classifier read the
    // body, and that must not have consumed it.
    expect(await execution.response.json()).toEqual({
      outputs: [{ id: "echo", value: "Hello plugfest!" }],
    });
  });

  it("200, image/png → immediate, and the body is never parsed", async () => {
    const envelope = envelopeOf(200, { "Content-Type": "image/png" }, "PNG\r\n\n");
    const execution = await classify(envelope);

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(execution.response.mediaType).toBe("image/png");
    expect(execution.response.isJson).toBe(false);
  });

  it("201 + absolute Location → job, discoveredVia location-header", async () => {
    const envelope = envelopeOf(201, {
      "Content-Type": "application/json",
      Location: "https://service.test/oapi/jobs/8f2c",
    });
    const execution = await classify(envelope, "async");

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.statusUrl).toBe("https://service.test/oapi/jobs/8f2c");
    expect(execution.job.discoveredVia).toBe("location-header");
    expect(execution.job.jobId).toBe("8f2c");
  });

  it("202 + relative Location → job, statusUrl resolved against the response URL", async () => {
    // Reduction test 2: use Location verbatim and this row goes red.
    //
    // It also depends on Task 1 preserving the post-redirect URL on the
    // envelope. A relative Location is legal and common behind a gateway, and
    // resolving it against the URL the caller *typed* rather than the one the
    // response came from lands the job handle at the wrong path — the same
    // RFC 3986 §5.2.3 trap that shaped links/resolve.ts.
    // The base is …/oapi/processes/hello-world/execution, so climbing two
    // segments is what reaches …/oapi/jobs — which is the point: the answer
    // depends on the whole served path, not on the origin.
    const envelope = envelopeOf(202, { Location: "../../jobs/8f2c" });
    const execution = await classify(envelope);

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.statusUrl).toBe("https://service.test/oapi/jobs/8f2c");
    expect(execution.job.discoveredVia).toBe("location-header");
  });

  it("200 with a JSON body carrying status and jobID → job", async () => {
    // Reduction test 1: classify on requestedMode and this row goes red,
    // because the caller asked for sync. Some servers answer 200 with a job
    // document, and reading that as an immediate result hands the web app a
    // status document to render as if it were the answer.
    const envelope = envelopeOf(
      200,
      { "Content-Type": "application/json", Location: "https://service.test/oapi/jobs/8f2c" },
      '{"jobID":"8f2c","status":"accepted","processID":"hello-world"}',
    );
    const execution = await classify(envelope, "sync");

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.jobId).toBe("8f2c");
    expect(execution.requestedMode).toBe("sync");
  });

  it("201, no Location, body carries a self link → job, discoveredVia body-link", async () => {
    // Reduction test 3: remove the body-link fallback and this row goes red.
    // This is the browser path — Location is not CORS-safelisted, so a
    // cross-origin response has it filtered out (finding 0002).
    const envelope = envelopeOf(
      201,
      { "Content-Type": "application/json" },
      '{"jobID":"8f2c","status":"accepted",' +
        '"links":[{"rel":"self","type":"application/json","href":"/oapi/jobs/8f2c"}]}',
    );
    const execution = await classify(envelope, "async");

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.discoveredVia).toBe("body-link");
    expect(execution.job.statusUrl).toBe("https://service.test/oapi/jobs/8f2c");
  });

  it('201, no Location, body carries ZOO\'s rel="monitor" → job via the body link', async () => {
    // ZOO's real async 201 body, trimmed. `monitor` is not `self`, so a
    // fallback that only looked for `self` would leave the one server whose
    // body *can* rescue a browser unable to do so.
    const envelope = envelopeOf(
      201,
      { "Content-Type": "application/json;charset=UTF-8" },
      '{"jobID":"86bd9c38","status":"running","processID":"echo","links":[' +
        '{"title":"Status location","rel":"monitor","type":"application/json",' +
        '"href":"http://localhost:5090/ogc-api/jobs/86bd9c38"}]}',
    );
    const execution = await classify(envelope, "async");

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.discoveredVia).toBe("body-link");
    expect(execution.job.statusUrl).toBe("http://localhost:5090/ogc-api/jobs/86bd9c38");
  });

  it("201, no Location, no usable body → AmbiguousExecutionResponseError", async () => {
    const envelope = envelopeOf(201, { "Content-Type": "application/json" }, "null");

    await expect(classify(envelope, "async")).rejects.toThrow(AmbiguousExecutionResponseError);
    // The message has to carry everything: whoever reads it is looking at an
    // unfamiliar server.
    await expect(classify(envelope, "async")).rejects.toThrow(/Location absent/);
  });

  it("200 with a Location but a result body → immediate, against the brief", async () => {
    // The brief's rule 1 said a Location header alone means a job. pygeoapi
    // 0.21.0 sends Location on *every* synchronous execution — verified
    // 2026-09-01 — while the body is the finished result. Following the brief
    // would classify every pygeoapi sync run as a job, discard the answer, and
    // break the sync-execution demo path. See finding 0024.
    const envelope = envelopeOf(
      200,
      {
        "Content-Type": "application/json",
        Location: "http://localhost:5080/jobs/2d979ce4-a5e4-11f1-93ea-ba40680883d4",
      },
      '{"id":"echo","value":"Hello plugfest!"}',
    );
    const execution = await classify(envelope, "sync");

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(await execution.response.json()).toEqual({ id: "echo", value: "Hello plugfest!" });
  });
});

describe("classification edge cases the servers actually produce", () => {
  it("does not choke on XML mislabelled as application/json", async () => {
    // ZOO's raw mode returns GML under Content-Type: application/json
    // (finding 0026). isJson says yes, JSON.parse says no, and a classifier
    // that let that throw would turn a diagnosable server bug into a stack
    // trace from inside our own error handling.
    const envelope = envelopeOf(
      200,
      { "Content-Type": "application/json;charset=UTF-8" },
      '<?xml version="1.0"?><ogr:FeatureCollection/>',
    );
    const execution = await classify(envelope);

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(await execution.response.text()).toContain("FeatureCollection");
  });

  it('does not read a job document out of type: "process" alone', async () => {
    // ZOO writes type: "process" on job documents, but a result document may
    // carry a `type` too — a GeoJSON result is {"type":"FeatureCollection"}.
    // Only a `status` in the OGC job vocabulary discriminates.
    const envelope = envelopeOf(
      200,
      { "Content-Type": "application/geo+json" },
      '{"type":"FeatureCollection","features":[]}',
    );
    expect((await classify(envelope)).kind).toBe("immediate");
  });

  it("ignores a status value that is not in the job vocabulary", async () => {
    const envelope = envelopeOf(
      200,
      { "Content-Type": "application/json" },
      '{"status":"OK","value":3}',
    );
    expect((await classify(envelope)).kind).toBe("immediate");
  });

  it("records job-document members it does not model, by name only", async () => {
    const envelope = envelopeOf(
      201,
      { "Content-Type": "application/json", Location: "/oapi/jobs/8f2c" },
      '{"jobID":"8f2c","status":"accepted","vendorHint":"x","estimatedCost":9}',
    );
    const evidence = await gatherEvidence(envelope);

    expect(evidence.unrecognisedKeys).toEqual(["vendorHint", "estimatedCost"]);
  });

  it("falls back to the Location tail when the body carries no job id", async () => {
    const envelope = envelopeOf(202, { Location: "/oapi/jobs/8f2c-with%20space" });
    const execution = await classify(envelope, "async");

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.jobId).toBe("8f2c-with space");
  });

  it("prefers the Location header over a body link when both are present", async () => {
    const envelope = envelopeOf(
      201,
      { "Content-Type": "application/json", Location: "/oapi/jobs/from-header" },
      '{"status":"accepted","links":[{"rel":"monitor","href":"/oapi/jobs/from-body"}]}',
    );
    const execution = await classify(envelope, "async");

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.discoveredVia).toBe("location-header");
    expect(execution.job.statusUrl).toBe("https://service.test/oapi/jobs/from-header");
    // The body links are still handed over whole — Task 5 needs them.
    expect(execution.job.links.map((link) => link.rel)).toEqual(["monitor"]);
  });
});
