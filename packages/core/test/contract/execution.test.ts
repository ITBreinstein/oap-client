/**
 * Execution against pygeoapi 0.21.0, pinned in infra/compose/pygeoapi.yml.
 *
 * Every expectation was derived from what the running server actually sends on
 * 2026-09-01, not from what the specification says it should. Where the two
 * disagree the test asserts the server's behaviour and names the finding, so
 * that an upstream fix shows up as a failure to re-read rather than as drift
 * nobody notices until a plugfest.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "../../src/index.js";
import { ProcessesError } from "../../src/http/errors.js";
import { send } from "../../src/http/transport.js";
import type { Observation } from "../../src/observations.js";
import type { ProcessDescription } from "../../src/processes/types.js";

const CORS = "http://localhost:5080";

let client: Client;
let seen: Observation[];
let helloWorld: ProcessDescription;

function executions(): Extract<Observation, { kind: "execution" }>[] {
  return seen.filter((entry) => entry.kind === "execution");
}

beforeAll(async () => {
  seen = [];
  client = createClient({ baseUrl: CORS, onObservation: (entry) => seen.push(entry) });
  try {
    await send(CORS, { signal: AbortSignal.timeout(5000) });
  } catch (cause) {
    throw new Error(
      `pygeoapi is not answering on ${CORS}. Start it with:\n` +
        `  docker compose -f infra/compose/pygeoapi.yml up -d --wait`,
      { cause },
    );
  }
  helloWorld = await client.getProcess("hello-world");
});

describe("sync execution against pygeoapi", () => {
  it("runs hello-world and returns the result, not a job", async () => {
    const execution = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      mode: "sync",
      description: helloWorld,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(execution.response.status).toBe(200);
    expect(execution.response.mediaType).toBe("application/json");
    expect(await execution.response.json()).toEqual({ id: "echo", value: "Hello plugfest!" });
  });

  it("is immediate despite a Location header on the 200 — finding 0024", async () => {
    // pygeoapi sends Location on *every* synchronous execution, pointing at a
    // real, already-successful job. The brief's rule 1 would call this a job,
    // discard the result, and hand the web app a status document to render as
    // if it were the answer. Classification is on evidence: a 200 whose body is
    // not a job document is an immediate result, whatever the header says.
    const execution = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      description: helloWorld,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    // The header really is there. That is the whole point of the test.
    expect(execution.response.location).toMatch(/\/jobs\//);
  });

  it('wraps outputs in an array for response: "document", which the spec keys by id', async () => {
    // 18-062r2 §7.11 describes the document response as an object keyed by
    // output id. pygeoapi returns {"outputs": [{"id": …, "value": …}]}.
    // Asserted as observed — see finding 0027.
    const execution = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      response: "document",
      description: helloWorld,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(await execution.response.json()).toEqual({
      outputs: [{ id: "echo", value: "Hello plugfest!" }],
    });
  });

  it('ignores response: "raw" and answers identically to the default', async () => {
    // Finding 0027: raw is not honoured. The bare value never appears.
    const raw = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      response: "raw",
      description: helloWorld,
    });

    expect(raw.kind).toBe("immediate");
    if (raw.kind !== "immediate") throw new Error("unreachable");
    expect(await raw.response.json()).toEqual({ id: "echo", value: "Hello plugfest!" });
  });

  it("records elapsed time and the resolved route", async () => {
    const before = executions().length;
    await client.execute("hello-world", { inputs: { name: "p" }, description: helloWorld });

    const record = executions()[before];
    expect(record?.outcome).toBe("immediate");
    // The description advertises an execute link, so the constructed path is
    // never reached against this server.
    expect(record?.route).toBe("advertised-link");
    expect(record?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(record?.locationPresent).toBe(true);
  });
});

describe("async execution against pygeoapi", () => {
  it("returns a job from Prefer: respond-async, discovered via the Location header", async () => {
    const execution = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      mode: "async",
      description: helloWorld,
    });

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.discoveredVia).toBe("location-header");
    expect(execution.job.statusUrl).toMatch(/^http:\/\/localhost:5080\/jobs\//);
    expect(execution.job.jobId).toBeDefined();
  });

  it("has no body link to fall back on, because the 201 body is null — finding 0004", async () => {
    // In a browser, Location is filtered out (finding 0002) and the body is
    // `null`, so there is nothing left to name the job with. This test pins
    // the emptiness that makes that combination fatal, and is what Task 5 has
    // to plan around.
    const execution = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      mode: "async",
      description: helloWorld,
    });

    expect(execution.kind).toBe("job");
    if (execution.kind !== "job") throw new Error("unreachable");
    expect(execution.job.links).toEqual([]);
  });

  it("does not expose Location to a browser, so the header route is Node-only", async () => {
    // Finding 0002, re-confirmed 2026-09-01. Asserted at the transport rather
    // than through execute(), because Node applies no CORS filtering and the
    // absence of the opt-in is the only thing observable from here.
    const response = await send(`${CORS}/processes/hello-world/execution`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        Prefer: "respond-async",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ inputs: { name: "p" } }),
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-expose-headers")).toBeNull();
  });
});

describe("what pygeoapi does with a request it dislikes", () => {
  it("answers a missing required input with 400 and an explanation", async () => {
    // Asserted as recorded, per step-zero question 6. pygeoapi gets the status
    // class right; the body is not RFC 7807 (finding 0001), which is why the
    // useful text is in `extensions.description`.
    const failure = await client
      .execute("hello-world", { inputs: {}, description: helloWorld })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProcessesError);
    if (!(failure instanceof ProcessesError)) throw new Error("unreachable");
    expect(failure.status).toBe(400);
    expect(JSON.stringify(failure.problem)).toContain("Cannot process without a name");
  });

  it("coerces a wrong-typed input rather than rejecting it", async () => {
    // A number where the schema says string. pygeoapi answers 200 with
    // "Hello 42!". Recorded, not corrected: the core does not validate values.
    const execution = await client.execute("hello-world", {
      inputs: { name: 42 },
      description: helloWorld,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(await execution.response.json()).toEqual({ id: "echo", value: "Hello 42!" });
  });

  it('silently ignores transmissionMode: "reference" it never declared', async () => {
    // Step-zero question 7. pygeoapi declares outputTransmission: ["value"]
    // only, and answers a reference request with the value inline and no
    // error at all — the execution-level version of the under-declaration
    // problem. See finding 0028.
    expect(helloWorld.outputTransmission).toEqual(["value"]);

    const execution = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      outputs: { echo: { transmissionMode: "reference" } },
      description: helloWorld,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(await execution.response.json()).toEqual({ id: "echo", value: "Hello plugfest!" });
  });

  it("silently drops an outputs block naming an output it does not have", async () => {
    const execution = await client.execute("hello-world", {
      inputs: { name: "plugfest" },
      outputs: { nosuch: {} },
      description: helloWorld,
    });

    expect(execution.kind).toBe("immediate");
    if (execution.kind !== "immediate") throw new Error("unreachable");
    expect(await execution.response.json()).toEqual({});
  });
});

describe("content negotiation on the execution endpoint", () => {
  it("answers JSON whatever Accept says, including a browser's own list", async () => {
    // Step-zero question 9. This is why the T2 refinement — Accept:
    // application/json when response is "document" — was not taken: there is
    // no evidence it would change anything, on either server.
    const accepts = [
      "*/*",
      "application/json",
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ];

    for (const accept of accepts) {
      const response = await send(`${CORS}/processes/hello-world/execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: accept },
        body: JSON.stringify({ inputs: { name: "p" } }),
      });
      expect(response.status).toBe(200);
      expect(response.mediaType).toBe("application/json");
    }
  });
});
