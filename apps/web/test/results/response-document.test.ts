/**
 * What the result screen makes of each server's answer to `response`, with two
 * or more outputs, from the captures of the response-document step zero
 * (2026-10-31): pygeoapi's wrapped document (finding 0027), and the documents
 * ZOO, Weaver and the Beleidsnormen API send.
 */

import { describe, expect, it } from "vitest";
import { toRenderable, type RenderOptions } from "../../src/results/renderable.js";
import { resultObservations } from "../../src/observations.js";
import { envelopeOf } from "./http-fixtures.js";

const FEATURE_AREA: RenderOptions = {
  outputIds: ["features", "table"],
  processId: "breinstein-feature-area",
  declaredMediaTypes: { features: "application/geo+json", table: "text/csv" },
};
const FEATURE_AREA_URL = "http://localhost:5080/processes/breinstein-feature-area/execution";
const RUSTPLEKKEN: RenderOptions = {
  outputIds: ["percentage_voldoet", "legend_output", "geometry_output", "bankjes_output"],
  processId: "rustplekken",
};
const BELEIDSNORMEN_URL = "https://beleidsnormen.example/api/processes/rustplekken/execution";

const shape = (results: Awaited<ReturnType<typeof toRenderable>>) =>
  results.map((result) => `${result.kind}:${result.outputId}`);

describe("pygeoapi's answer to response: document (finding 0027)", () => {
  const document = "pygeoapi/execution/breinstein-feature-area-two-outputs-document.http";

  it("reads the map inside the one-element outputs array, when a document was asked for", async () => {
    const results = await toRenderable(envelopeOf(document, FEATURE_AREA_URL), {
      ...FEATURE_AREA,
      requestedResponse: "document",
    });
    expect(shape(results)).toEqual(["json:features", "text:table"]);
    expect(results.every((result) => result.documentWrapper === "outputs-array")).toBe(true);
  });

  it("records the wrapper on each output's result observation", async () => {
    const results = await toRenderable(envelopeOf(document, FEATURE_AREA_URL), {
      ...FEATURE_AREA,
      requestedResponse: "document",
    });
    const observations = resultObservations(
      {
        runId: "run",
        endpoint: "http://localhost:5080",
        processId: "breinstein-feature-area",
        declaredTransmission: ["value"],
        linkOutputs: [],
      },
      results,
    );
    expect(observations.map((observation) => observation.documentWrapper)).toEqual([
      "outputs-array",
      "outputs-array",
    ]);
  });

  it("shows the body whole when no document was asked for", async () => {
    const results = await toRenderable(envelopeOf(document, FEATURE_AREA_URL), FEATURE_AREA);
    expect(shape(results)).toEqual(["json:result"]);
    expect(results[0]?.documentWrapper).toBeUndefined();
  });

  it("reads a by-reference document the same way, one output and all", async () => {
    const results = await toRenderable(
      envelopeOf(
        "pygeoapi/execution/breinstein-buildings-reference-document.http",
        "http://localhost:5080/processes/breinstein-buildings/execution",
      ),
      {
        outputIds: ["buildings"],
        processId: "breinstein-buildings",
        requestedResponse: "document",
      },
    );
    expect(shape(results)).toEqual(["reference:buildings"]);
    expect(results[0]?.documentWrapper).toBe("outputs-array");
  });

  it("does not unwrap an `outputs` that is itself a declared output", async () => {
    const results = await toRenderable(envelopeOf(document, FEATURE_AREA_URL), {
      ...FEATURE_AREA,
      outputIds: ["outputs", "features", "table"],
      requestedResponse: "document",
    });
    expect(results.some((result) => result.documentWrapper !== undefined)).toBe(false);
  });

  it("leaves the raw answer, the process's own map, as it was", async () => {
    const results = await toRenderable(
      envelopeOf(
        "pygeoapi/execution/breinstein-feature-area-two-outputs-raw.http",
        FEATURE_AREA_URL,
      ),
      FEATURE_AREA,
    );
    expect(shape(results)).toEqual(["json:features", "text:table"]);
  });
});

describe("the other servers' documents", () => {
  it("splits the Beleidsnormen document into its four outputs, with no wrapper", async () => {
    const results = await toRenderable(
      envelopeOf(
        "beleidsnormen/execution/rustplekken-every-output-document.http",
        BELEIDSNORMEN_URL,
      ),
      { ...RUSTPLEKKEN, requestedResponse: "document" },
    );
    expect(shape(results)).toEqual([
      "json:percentage_voldoet",
      "json:legend_output",
      "json:geometry_output",
      "json:bankjes_output",
    ]);
    const geometry = results[2];
    expect(geometry?.kind === "json" && (geometry.value as { type?: unknown }).type).toBe(
      "FeatureCollection",
    );
    expect(results.some((result) => result.documentWrapper !== undefined)).toBe(false);
  });

  it("splits ZOO's document, which it also sends when no response was asked (finding 0072)", async () => {
    const options: RenderOptions = { outputIds: ["a", "b", "c", "pause"], processId: "echo" };
    const url = "http://localhost:5090/ogc-api/processes/echo/execution";
    const asked = await toRenderable(
      envelopeOf("zoo-project/execution/echo-two-outputs-document.http", url),
      { ...options, requestedResponse: "document" },
    );
    const unasked = await toRenderable(
      envelopeOf("zoo-project/execution/echo-two-outputs-none.http", url),
      options,
    );
    expect(shape(asked)).toEqual(["text:a", "json:c"]);
    expect(shape(unasked)).toEqual(shape(asked));
  });

  it("splits Weaver's document, a link among the values", async () => {
    const results = await toRenderable(
      envelopeOf(
        "weaver/execution/echo-two-outputs-document.http",
        "http://localhost:5100/processes/EchoProcess/execution",
      ),
      {
        outputIds: ["stringOutput", "featureCollectionOutput"],
        processId: "EchoProcess",
        requestedResponse: "document",
      },
    );
    expect(shape(results)).toEqual(["text:stringOutput", "reference:featureCollectionOutput"]);
  });
});
