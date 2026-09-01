/**
 * Execution against the pinned ZOO-Project fork on :5090.
 *
 * This lane reports and never blocks: it skips itself when nothing is
 * answering. See infra/zoo/README.md for why ZOO is not in the contract lane.
 *
 * Two things here are not in the brief, and both are step-zero findings that
 * change what the sync-execution demo can rely on:
 *
 * - ZOO refuses an execute body carrying only `inputs` (finding 0025), so every
 *   request below supplies an `outputs` block. The core does **not** add one —
 *   that would be a per-server workaround hiding the defect we were funded to
 *   find — so the caller does, which is exactly what `apps/web` will have to do.
 * - ZOO's raw mode answers with XML under `Content-Type: application/json`
 *   (finding 0026). The classifier survives it; the result adapters will have
 *   to.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ZOO, answering } from "./zoo.js";
import { createClient, type Client } from "../../src/index.js";
import { ProcessesError } from "../../src/http/errors.js";
import { send } from "../../src/http/transport.js";
import type { Observation } from "../../src/observations.js";
import type { ProcessDescription } from "../../src/processes/types.js";

// Resolved at module scope, the way the other interop files do it:
// `describe.skipIf` is evaluated when the file is collected, which is before
// any `beforeAll` has run.
const zooUp = await answering();

let client: Client;
let seen: Observation[];
let echo: ProcessDescription;

/** Every request needs one; see finding 0025. */
const OUTPUTS = { a: {} } as const;

function executions(): Extract<Observation, { kind: "execution" }>[] {
  return seen.filter((entry) => entry.kind === "execution");
}

beforeAll(async () => {
  if (!zooUp) return;
  seen = [];
  client = createClient({ baseUrl: `${ZOO}/`, onObservation: (entry) => seen.push(entry) });
  echo = await client.getProcess("echo");
});

describe.skipIf(!zooUp)("sync execution against ZOO", () => {
  it("runs echo and returns the result document", async () => {
    const execution = await client.execute("echo", {
      inputs: { a: "plugfest" },
      outputs: OUTPUTS,
      mode: "sync",
      description: echo,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(execution.response.status).toBe(200);
    expect(await execution.response.json()).toEqual({ a: "plugfest" });
  });

  it("sends no Location on a synchronous run, unlike pygeoapi", async () => {
    const execution = await client.execute("echo", {
      inputs: { a: "plugfest" },
      outputs: OUTPUTS,
      description: echo,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(execution.response.location).toBeUndefined();
  });

  it("POSTs to the execute link ZOO advertises in the long OGC URI form", async () => {
    const before = executions().length;
    await client.execute("echo", { inputs: { a: "p" }, outputs: OUTPUTS, description: echo });

    expect(executions()[before]?.route).toBe("advertised-link");
  });

  it("runs the ogc-bbox input from finding 0023 with real coordinates", async () => {
    // The closest thing to the spatial demo path that exists today: a
    // bounding box, inline, drawn on a map and posted as an execute input.
    const execution = await client.execute("echo", {
      inputs: { c: { bbox: [4.3, 52.0, 4.4, 52.1], crs: "urn:ogc:def:crs:EPSG:6.6:4326" } },
      outputs: { c: {} },
      description: echo,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(await execution.response.json()).toEqual({
      c: { bbox: [4.3, 52.0, 4.4, 52.1], crs: "urn:ogc:def:crs:EPSG:6.6:4326" },
    });
  });
});

describe.skipIf(!zooUp)("async execution against ZOO", () => {
  it("returns a job, discovered via the Location header from Node", async () => {
    const execution = await client.execute("echo", {
      inputs: { a: "plugfest" },
      outputs: OUTPUTS,
      mode: "async",
      description: echo,
    });

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.discoveredVia).toBe("location-header");
    expect(execution.job.statusUrl).toMatch(/^http:\/\/localhost:5090\/ogc-api\/jobs\//);
    expect(execution.job.jobId).toBeDefined();
  });

  it('also carries a rel="monitor" body link, which is the browser\'s only route', async () => {
    // ZOO sends no CORS headers at all (finding 0009), so cross-origin the
    // Location header is unreadable. Unlike pygeoapi's `null` body, ZOO's 201
    // carries a full job document whose `monitor` link names the job — so the
    // T7 fallback has something real to find. This is the difference between
    // the two servers that Task 5 has to build around.
    const execution = await client.execute("echo", {
      inputs: { a: "plugfest" },
      outputs: OUTPUTS,
      mode: "async",
      description: echo,
    });

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    const monitor = execution.job.links.find((link) => link.rel === "monitor");
    expect(monitor?.href).toBe(execution.job.statusUrl);
  });

  it("echoes Preference-Applied, so the preference was honoured and not guessed", async () => {
    const response = await send(`${ZOO}/processes/echo/execution`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*", Prefer: "respond-async" },
      body: JSON.stringify({ inputs: { a: "p" }, outputs: OUTPUTS }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("preference-applied")).toBe("respond-async");
  });
});

describe.skipIf(!zooUp)("what ZOO does with a request it dislikes", () => {
  it("refuses a body carrying only inputs — finding 0025", async () => {
    // The minimal spec-conformant execute body. ZOO cannot parse it, and the
    // core deliberately does not paper over that by synthesising an `outputs`
    // block: a per-server workaround would hide the defect. Asserted as
    // observed so an upstream fix surfaces as a failure to re-read.
    const failure = await client
      .execute("echo", { inputs: { a: "plugfest" }, description: echo })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProcessesError);
    if (!(failure instanceof ProcessesError)) throw new Error("unreachable");
    expect(failure.status).toBe(400);
    expect(JSON.stringify(failure.problem)).toContain("cannot parse your POST data");
  });

  it('refuses response: "document" unless an outputs block is also present', async () => {
    // "document" is the OGC default. Sending it alone is a 400; sending it
    // beside any `outputs` member works. Part of finding 0025.
    await expect(
      client.execute("echo", {
        inputs: { a: "p" },
        response: "document",
        description: echo,
      }),
    ).rejects.toThrow(ProcessesError);

    const withOutputs = await client.execute("echo", {
      inputs: { a: "p" },
      outputs: OUTPUTS,
      response: "document",
      description: echo,
    });
    expect(withOutputs.kind).toBe("immediate");
  });

  it("reports a missing required input as 500 — finding 0016, still true", async () => {
    // Asserted as the *recorded* behaviour, per step-zero question 6. A 500
    // here means retry, which can never succeed; the core does not translate
    // it into an input-validation error, because it does not know that.
    const failure = await client
      .execute("echo", { inputs: {}, outputs: OUTPUTS, description: echo })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProcessesError);
    if (!(failure instanceof ProcessesError)) throw new Error("unreachable");
    expect(failure.status).toBe(500);
    expect(JSON.stringify(failure.problem)).toContain("at least one input");
  });

  it("rejects an outputs block naming an unknown output, unlike pygeoapi", async () => {
    // Where pygeoapi silently drops it and answers 200 {}, ZOO answers 400 and
    // names the offending argument. ZOO is right; the divergence is the point.
    const failure = await client
      .execute("echo", { inputs: { a: "p" }, outputs: { zzz: {} }, description: echo })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProcessesError);
    if (!(failure instanceof ProcessesError)) throw new Error("unreachable");
    expect(failure.status).toBe(400);
  });

  it("records the arity warning but still sends, for an unbounded input", async () => {
    // Gdal_Translate declares GCP as maxOccurs: "unbounded" — the one live
    // `"unbounded"` Task 3 found. It cannot be executed cheaply: it needs a
    // real raster, and fails at GDALOpen whatever we send. What *is* testable
    // is that the array wire shape reaches the service rather than being
    // rejected at parse time, and that a single value produces a warning and
    // is still sent.
    const gdal = await client.getProcess("Gdal_Translate");
    const before = executions().length;

    const failure = await client
      .execute("Gdal_Translate", {
        inputs: { GCP: "1 1 4.3 52.0", InputDSN: "/nonexistent.tif", OutputDSN: "out.tif" },
        outputs: { Result: {} },
        description: gdal,
      })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(executions()[before]?.warnings).toContain(
      'input "GCP" accepts multiple values but a single value was supplied',
    );
    // It got past parsing and died inside GDAL, which is what proves the
    // request was sent rather than blocked by our own warning.
    expect(failure).toBeInstanceOf(ProcessesError);
    if (!(failure instanceof ProcessesError)) throw new Error("unreachable");
    expect(JSON.stringify(failure.problem)).toContain("GDALOpen");
  });
});

describe.skipIf(!zooUp)("non-JSON results", () => {
  it("returns GML mislabelled as application/json in raw mode — finding 0026", async () => {
    // The one non-JSON reference case either server produces, and it arrives
    // under the wrong media type. The classifier must not throw on it, and the
    // envelope must hand the bytes over intact for the result adapters.
    const execution = await client.execute("Buffer", {
      inputs: {
        InputPolygon: {
          value: {
            type: "Polygon",
            coordinates: [
              [
                [4.3, 52.0],
                [4.4, 52.0],
                [4.4, 52.1],
                [4.3, 52.1],
                [4.3, 52.0],
              ],
            ],
          },
          mediaType: "application/json",
        },
        BufferDistance: 1,
      },
      outputs: { Result: {} },
      response: "raw",
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(execution.response.mediaType).toBe("application/json");
    expect(execution.response.isJson).toBe(true);
    // …and it is not JSON at all.
    const body = await execution.response.text();
    expect(body).toContain("<ogr:FeatureCollection");
    await expect(execution.response.json()).rejects.toThrow();
  });

  it("returns multipart/related in raw mode when no outputs block narrows it", async () => {
    // Every declared output comes back as a part, with Content-ID naming it,
    // even the ones the request never mentioned. Recorded for the result
    // adapters; nothing in the core interprets it.
    const response = await send(`${ZOO}/processes/echo/execution`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({ inputs: { a: "plugfest" }, response: "raw" }),
    });

    expect(response.status).toBe(200);
    expect(response.mediaType).toBe("multipart/related");
    const body = await response.text();
    expect(body).toContain("Content-ID: a");
  });
});

describe.skipIf(!zooUp)("content negotiation on the execution endpoint", () => {
  it("answers JSON whatever Accept says", async () => {
    // Step-zero question 9, ZOO half. Neither server negotiates on POST, which
    // is why the T2 refinement was not taken.
    for (const accept of ["*/*", "application/json", "text/html,*/*;q=0.8"]) {
      const response = await send(`${ZOO}/processes/echo/execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: accept },
        body: JSON.stringify({ inputs: { a: "p" }, outputs: OUTPUTS }),
      });
      expect(response.status).toBe(200);
      expect(response.mediaType).toBe("application/json");
    }
  });
});
