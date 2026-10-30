/**
 * The execute request in 1.0 and in the 2.0 draft, for each thing a caller can
 * mean by it — what goes on the wire, body and headers, and what is refused
 * before anything is sent.
 *
 * Two levels. `draftExecuteOptions()` on its own, for every intent; and the
 * whole client against Weaver's captured discovery documents, so the version
 * is chosen from a real declaration and the request is the one that leaves.
 */

import { describe, expect, it } from "vitest";
import { createClient } from "../../src/client.js";
import { draftExecuteOptions } from "../../src/compat/processes-2.0-draft.js";
import { DraftUnsupportedRequestError } from "../../src/errors.js";
import type { ExecuteOptions } from "../../src/execution/types.js";
import type { Observation } from "../../src/observations.js";
import { parseDescription } from "../../src/processes/parse-description.js";
import type { ProcessDescription } from "../../src/processes/types.js";
import conformance from "../fixtures/weaver/conformance.json" with { type: "json" };
import echo from "../fixtures/weaver/processes/EchoProcess.json" with { type: "json" };
import landing from "../fixtures/weaver/landing-page.json" with { type: "json" };

const BASE = "http://localhost:5100/";
const EXECUTION = "http://localhost:5100/processes/EchoProcess/execution";

const description: ProcessDescription = parseDescription(echo, {
  documentUrl: "http://localhost:5100/processes/EchoProcess",
}).process;

/** The same process, with one output declared to take several values. */
const multiValued: ProcessDescription = {
  ...description,
  outputs: description.outputs.map((output) =>
    output.id === "geometryOutput" ? { ...output, maxOccurs: "unbounded", multiple: true } : output,
  ),
};

const inputs = { stringInput: "Value1" };

function refused(call: () => unknown): DraftUnsupportedRequestError {
  try {
    call();
  } catch (error) {
    if (error instanceof DraftUnsupportedRequestError) return error;
    throw error;
  }
  throw new Error("expected DraftUnsupportedRequestError, nothing was thrown");
}

describe("draftExecuteOptions", () => {
  it("leaves a request with no intent exactly as it was: nothing extra", () => {
    const options: ExecuteOptions = { inputs, outputs: { stringOutput: {}, dateOutput: {} } };
    expect(draftExecuteOptions(options)).toBe(options);
  });

  it("keeps a requested format, which the draft still has", () => {
    const options: ExecuteOptions = {
      inputs,
      outputs: { geometryOutput: { format: { mediaType: "application/geo+json" } } },
    };
    expect(draftExecuteOptions(options).outputs).toEqual(options.outputs);
  });

  it('says "raw" as one requested output, and drops the member', () => {
    const sent = draftExecuteOptions({
      inputs,
      outputs: { stringOutput: {} },
      response: "raw",
      description,
    });
    expect(sent).not.toHaveProperty("response");
    expect(Object.keys(sent.outputs ?? {})).toEqual(["stringOutput"]);
  });

  it('says "raw" with the outputs omitted when the description has only one', () => {
    const single = { ...description, outputs: description.outputs.slice(0, 1) };
    const sent = draftExecuteOptions({ inputs, response: "raw", description: single });
    expect(sent).not.toHaveProperty("response");
    expect(sent.outputs).toBeUndefined();
  });

  it('refuses "raw" for several outputs', () => {
    const error = refused(() =>
      draftExecuteOptions({
        inputs,
        outputs: { stringOutput: {}, dateOutput: {} },
        response: "raw",
      }),
    );
    expect(error.intent).toBe("raw");
    expect(error.reason).toBe("raw-needs-one-output");
    expect(error.outputIds).toEqual(["stringOutput", "dateOutput"]);
  });

  it('refuses "raw" for every output, when they are left to the description', () => {
    expect(
      refused(() => draftExecuteOptions({ inputs, response: "raw", description })).reason,
    ).toBe("raw-needs-one-output");
  });

  it('refuses "raw" for an output with maxOccurs above 1', () => {
    const error = refused(() =>
      draftExecuteOptions({
        inputs,
        outputs: { geometryOutput: {} },
        response: "raw",
        description: multiValued,
      }),
    );
    expect(error.reason).toBe("raw-needs-single-valued-output");
  });

  it('takes the draft\'s default maxOccurs of 1 for "raw" when there is no description', () => {
    const sent = draftExecuteOptions({ inputs, outputs: { anything: {} }, response: "raw" });
    expect(sent).not.toHaveProperty("response");
  });

  it('says "document" as two or more requested outputs, and drops the member', () => {
    const sent = draftExecuteOptions({
      inputs,
      outputs: { stringOutput: {}, dateOutput: {} },
      response: "document",
    });
    expect(sent).not.toHaveProperty("response");
    expect(Object.keys(sent.outputs ?? {})).toEqual(["stringOutput", "dateOutput"]);
  });

  it('refuses "document" for one output', () => {
    const error = refused(() =>
      draftExecuteOptions({ inputs, outputs: { stringOutput: {} }, response: "document" }),
    );
    expect(error.intent).toBe("document");
    expect(error.reason).toBe("document-needs-several-outputs");
  });

  it('refuses "raw" and "document" when nothing says how many outputs are asked for', () => {
    for (const response of ["raw", "document"] as const) {
      expect(refused(() => draftExecuteOptions({ inputs, response })).reason).toBe(
        "outputs-unknown",
      );
    }
  });

  it("refuses an output asked for by reference", () => {
    const error = refused(() =>
      draftExecuteOptions({
        inputs,
        outputs: { stringOutput: {}, imagesOutput: { transmissionMode: "reference" } },
      }),
    );
    expect(error.intent).toBe("reference");
    expect(error.reason).toBe("no-transmission-mode");
    expect(error.outputIds).toEqual(["imagesOutput"]);
  });

  it("refuses an output asked for by value: the draft cannot say that either", () => {
    const error = refused(() =>
      draftExecuteOptions({ inputs, outputs: { stringOutput: { transmissionMode: "value" } } }),
    );
    expect(error.intent).toBe("value");
  });
});

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

/**
 * Weaver as captured on 2026-10-23: its landing page and conformance document,
 * and an execute that answers what its `sync-one-output.http` did. Records
 * every request that reaches it.
 */
function weaver(): { fetch: typeof globalThis.fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ url, method, headers: new Headers(init.headers), body });
    const path = new URL(url).pathname;
    if (method === "POST") {
      return Promise.resolve(
        new Response("Value1", { headers: { "Content-Type": "text/plain; charset=UTF-8" } }),
      );
    }
    const document = path === "/conformance" ? conformance : landing;
    return Promise.resolve(
      new Response(JSON.stringify(document), { headers: { "Content-Type": "application/json" } }),
    );
  };
  return { fetch, sent };
}

function executes(sent: readonly Sent[]): Sent[] {
  return sent.filter((request) => request.method === "POST");
}

describe("the client, against Weaver's declaration", () => {
  it("chooses the draft from the declaration, and records why", async () => {
    const { fetch } = weaver();
    const seen: Observation[] = [];
    const client = createClient({ baseUrl: BASE, fetch, onObservation: (o) => seen.push(o) });
    await client.execute("EchoProcess", { inputs, outputs: { stringOutput: {} }, description });

    const record = seen.find((o) => o.kind === "execution");
    expect(record).toMatchObject({ protocolVersion: "2.0-draft", versionSource: "declared" });
    const derived = seen.find((o) => o.kind === "capabilities-derived");
    expect(derived).toMatchObject({ protocolVersion: "2.0-draft", versionSource: "declared" });
  });

  it("sends the same body and headers for a request with no intent, in either version", async () => {
    const bodies: unknown[] = [];
    const headers: Headers[] = [];
    for (const protocolVersion of ["auto", "1.0"] as const) {
      const { fetch, sent } = weaver();
      const client = createClient({ baseUrl: BASE, fetch, protocolVersion });
      await client.execute("EchoProcess", {
        inputs,
        outputs: { stringOutput: {}, dateOutput: {} },
        description,
      });
      const [request] = executes(sent);
      // The description's advertised link, whose rel Weaver writes https://.
      expect(request?.url).toBe(EXECUTION);
      bodies.push(request?.body);
      if (request !== undefined) headers.push(request.headers);
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toEqual({ inputs, outputs: { stringOutput: {}, dateOutput: {} } });
    for (const sentHeaders of headers) {
      expect(sentHeaders.get("prefer")).toBeNull();
      expect(sentHeaders.get("accept")).toBe("*/*");
      expect(sentHeaders.get("content-type")).toBe("application/json");
    }
  });

  it('writes "raw" as 1.0 says it when pinned to 1.0, and as the draft says it when not', async () => {
    const options = {
      inputs,
      outputs: { stringOutput: {} },
      response: "raw" as const,
      description,
    };

    const v1 = weaver();
    const pinned: Observation[] = [];
    await createClient({
      baseUrl: BASE,
      fetch: v1.fetch,
      protocolVersion: "1.0",
      onObservation: (o) => pinned.push(o),
    }).execute("EchoProcess", options);
    expect(executes(v1.sent)[0]?.body).toEqual({
      inputs,
      outputs: { stringOutput: {} },
      response: "raw",
    });
    expect(pinned.find((o) => o.kind === "execution")).toMatchObject({
      protocolVersion: "1.0",
      versionSource: "configured",
    });

    const v2 = weaver();
    await createClient({ baseUrl: BASE, fetch: v2.fetch }).execute("EchoProcess", options);
    expect(executes(v2.sent)[0]?.body).toEqual({ inputs, outputs: { stringOutput: {} } });
  });

  it('writes "document" with its member in 1.0 and without it in the draft', async () => {
    const options = {
      inputs,
      outputs: { stringOutput: {}, dateOutput: {} },
      response: "document" as const,
      description,
    };
    const v1 = weaver();
    await createClient({ baseUrl: BASE, fetch: v1.fetch, protocolVersion: "1.0" }).execute(
      "EchoProcess",
      options,
    );
    expect(executes(v1.sent)[0]?.body).toMatchObject({ response: "document" });

    const v2 = weaver();
    await createClient({ baseUrl: BASE, fetch: v2.fetch }).execute("EchoProcess", options);
    expect(executes(v2.sent)[0]?.body).not.toHaveProperty("response");
  });

  it("sends a by-reference request in 1.0, and sends nothing at all in the draft", async () => {
    const options = {
      inputs,
      outputs: { imagesOutput: { transmissionMode: "reference" as const } },
      description,
    };
    const v1 = weaver();
    await createClient({ baseUrl: BASE, fetch: v1.fetch, protocolVersion: "1.0" }).execute(
      "EchoProcess",
      options,
    );
    expect(executes(v1.sent)[0]?.body).toMatchObject({
      outputs: { imagesOutput: { transmissionMode: "reference" } },
    });

    const v2 = weaver();
    const outcome = await createClient({ baseUrl: BASE, fetch: v2.fetch })
      .execute("EchoProcess", options)
      .catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(DraftUnsupportedRequestError);
    expect(executes(v2.sent)).toEqual([]);
  });

  it("asks for an asynchronous run the same way in both: respond-async, and no return=", async () => {
    for (const protocolVersion of ["auto", "1.0"] as const) {
      const { fetch, sent } = weaver();
      await createClient({ baseUrl: BASE, fetch, protocolVersion }).execute("EchoProcess", {
        inputs,
        outputs: { stringOutput: {} },
        mode: "async",
        description,
      });
      expect(executes(sent)[0]?.headers.get("prefer")).toBe("respond-async");
    }
  });
});
