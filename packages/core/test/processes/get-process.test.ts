/**
 * `getProcess()`, and the two routes to the description document.
 *
 * The prefixed-self-link test is reduction test 3 in the brief: replace
 * link-first resolution with an unconditional `${base}/processes/${id}` and it
 * goes red, because the mock only serves the prefixed path the server
 * advertised.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw.setup.js";
import helloWorld from "../fixtures/pygeoapi/processes/hello-world.json" with { type: "json" };
import pygeoapiList from "../fixtures/pygeoapi/process-list.json" with { type: "json" };
import { ProcessNotFoundError } from "../../src/errors.js";
import { ProcessesError } from "../../src/http/errors.js";
import { getProcess, processUrlFor, resolveProcessUrl } from "../../src/processes/get-process.js";
import { createReport, parseSummary } from "../../src/processes/parse-summary.js";
import type { Observation } from "../../src/observations.js";
import type { ProcessSummary } from "../../src/processes/types.js";

const BASE = "https://service.test/oapi/";
const LIST = `${BASE}processes`;

function collect(): { sink: (observation: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (observation) => seen.push(observation), seen };
}

/** A summary advertising `self` at `href`, as both reference servers really do. */
function summaryWithSelf(id: string, href: string): ProcessSummary {
  return parseSummary(
    { id, version: "1.0.0", links: [{ rel: "self", type: "application/json", href }] },
    { documentUrl: LIST, where: "entry at index 0", report: createReport() },
  );
}

describe("processUrlFor", () => {
  it("appends the id under the list path", () => {
    expect(processUrlFor(LIST, "hello-world")).toBe(`${LIST}/hello-world`);
  });

  it("encodes an id that would otherwise change the URL's meaning", () => {
    // Neither reference server exposes such an id today — ZOO's 703 are all
    // unreserved characters — so this is the only place the guarantee is
    // testable, and it is the reason it is tested at all.
    expect(processUrlFor(LIST, "a/b")).toBe(`${LIST}/a%2Fb`);
    expect(processUrlFor(LIST, "with space")).toBe(`${LIST}/with%20space`);
    expect(processUrlFor(LIST, "ns:proc?x=1")).toBe(`${LIST}/ns%3Aproc%3Fx%3D1`);
  });

  it("keeps ids that legitimately contain dots and underscores readable", () => {
    expect(processUrlFor(LIST, "org.n52.javaps.test.EchoProcess")).toBe(
      `${LIST}/org.n52.javaps.test.EchoProcess`,
    );
  });

  it("drops the list's query rather than carrying it onto a different resource", () => {
    // A list reached through the ?f=json fallback ends in a query; appending
    // there would land the guess one path segment too high.
    expect(processUrlFor(`${LIST}?f=json`, "p")).toBe(`${LIST}/p`);
  });

  it("stays under a path prefix", () => {
    expect(processUrlFor("https://gateway.test/a/b/processes", "p")).toBe(
      "https://gateway.test/a/b/processes/p",
    );
  });
});

describe("resolveProcessUrl", () => {
  it("prefers the summary's self link over anything it could rebuild", () => {
    const summary = summaryWithSelf("p", "https://elsewhere.test/api/v2/processes/p");

    expect(resolveProcessUrl(LIST, "p", summary)).toEqual({
      url: "https://elsewhere.test/api/v2/processes/p",
      route: "advertised-link",
    });
  });

  it("falls back to the constructed path when no summary is supplied", () => {
    expect(resolveProcessUrl(LIST, "p", undefined)).toEqual({
      url: `${LIST}/p`,
      route: "constructed-path",
    });
  });

  it("falls back when the summary advertises links but no self", () => {
    const summary = parseSummary(
      { id: "p", version: "1", links: [{ rel: "alternate", href: `${LIST}/p.html` }] },
      { documentUrl: LIST, where: "x", report: createReport() },
    );

    expect(resolveProcessUrl(LIST, "p", summary).route).toBe("constructed-path");
  });
});

describe("getProcess", () => {
  it("follows the self link a list entry advertised, prefix and all", async () => {
    // Reduction test 3: only the advertised path is served. A client that
    // rebuilds `${LIST}/hello-world` gets an unhandled-request error.
    const advertised = `${BASE}v2/things/hello-world`;
    server.use(http.get(advertised, () => HttpResponse.json(helloWorld)));

    const summary = parseSummary(pygeoapiList.processes[0], {
      documentUrl: LIST,
      where: "entry at index 0",
      report: createReport(),
    });
    const withPrefix: ProcessSummary = { ...summary, links: [{ rel: "self", href: advertised }] };

    const { sink, seen } = collect();
    const process = await getProcess(LIST, "hello-world", {
      summary: withPrefix,
      onObservation: sink,
    });

    expect(process.id).toBe("hello-world");
    expect(seen.find((entry) => entry.kind === "process-fetched")).toMatchObject({
      route: "advertised-link",
    });
  });

  it("uses the constructed path when the caller has no list entry", async () => {
    server.use(http.get(`${LIST}/hello-world`, () => HttpResponse.json(helloWorld)));

    const { sink, seen } = collect();
    const process = await getProcess(LIST, "hello-world", { onObservation: sink });

    expect(process.inputs.map((input) => input.id)).toEqual(["name", "message"]);
    expect(seen.find((entry) => entry.kind === "process-fetched")).toMatchObject({
      route: "constructed-path",
      inputCount: 2,
      outputCount: 1,
      declaredJobControlOptions: ["sync-execute", "async-execute"],
      jobControlDefaulted: false,
    });
  });

  it("puts the schema census on the observation and nothing else", async () => {
    server.use(http.get(`${LIST}/hello-world`, () => HttpResponse.json(helloWorld)));

    const { sink, seen } = collect();
    await getProcess(LIST, "hello-world", { onObservation: sink });

    const observation = seen.find((entry) => entry.kind === "process-fetched");
    expect(observation?.kind === "process-fetched" && observation.schemaShapes).toEqual({
      total: 2,
      inlineType: 2,
      enumerated: 0,
      ref: 0,
      composed: 0,
      contentMediaType: 0,
      formatted: 0,
      absent: 0,
    });
    // The catalogue is counts only: no ids, titles, descriptions or values.
    expect(JSON.stringify(observation)).not.toContain("The name of the person");
  });

  it("turns a 404 into ProcessNotFoundError, keeping the transport error as cause", async () => {
    server.use(
      http.get(`${LIST}/nope`, () =>
        HttpResponse.json(
          { code: "NoSuchProcess", type: "NoSuchProcess", description: "Identifier not found" },
          { status: 404 },
        ),
      ),
    );

    const error = await getProcess(LIST, "nope").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessNotFoundError);
    expect((error as ProcessNotFoundError).processId).toBe("nope");
    expect((error as ProcessNotFoundError).message).toMatch(/No process "nope" on this service/);
    expect((error as ProcessNotFoundError).cause).toBeInstanceOf(ProcessesError);
  });

  it("leaves a 500 as the transport's own error", async () => {
    server.use(
      http.get(`${LIST}/broken`, () => HttpResponse.json({ title: "boom" }, { status: 500 })),
    );

    const error = await getProcess(LIST, "broken").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProcessesError);
    expect(error).not.toBeInstanceOf(ProcessNotFoundError);
  });

  it("threads the abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    server.use(http.get(`${LIST}/hello-world`, () => HttpResponse.json(helloWorld)));

    await expect(
      getProcess(LIST, "hello-world", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
