/**
 * Task 8, T1: an output given by reference is its own arm, from every results
 * body the two reference servers were seen to send (step zero, 2026-09-26).
 */

import { createEnvelope } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { toRenderable } from "../../src/results/renderable.js";
import { envelopeOf } from "./http-fixtures.js";

const PYGEOAPI_EXECUTE = "http://localhost:5080/processes/breinstein-buildings/execution";
const ZOO = "http://localhost:5090/ogc-api/processes";
const PDOK_QUERY =
  "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items?f=json&bbox=5.118%2C52.089%2C5.124%2C52.093&limit=1000";

describe("the reference arm, from pygeoapi", () => {
  const buildings = {
    kind: "reference",
    outputId: "buildings",
    href: PDOK_QUERY,
    mediaType: "application/geo+json",
    rel: "related",
    title: "The buildings in the bounding box of the area",
  };

  it("reads the synchronous results document", async () => {
    const envelope = envelopeOf(
      "pygeoapi/execution/breinstein-buildings-reference-sync.http",
      PYGEOAPI_EXECUTE,
    );
    expect(
      await toRenderable(envelope, { outputIds: ["buildings"], processId: "breinstein-buildings" }),
    ).toEqual([buildings]);
  });

  it("reads the asynchronous one the same, key order aside", async () => {
    const envelope = envelopeOf(
      "pygeoapi/jobs/breinstein-buildings-reference-results.http",
      "http://localhost:5080/jobs/edf923b6-b9e2-11f1-b675-420029103952/results",
    );
    expect(
      await toRenderable(envelope, { outputIds: ["buildings"], processId: "breinstein-buildings" }),
    ).toEqual([buildings]);
  });

  it("does not split response:document's outputs array (finding 0027)", async () => {
    const envelope = envelopeOf(
      "pygeoapi/execution/breinstein-buildings-reference-document.http",
      PYGEOAPI_EXECUTE,
    );
    const [only] = await toRenderable(envelope, {
      outputIds: ["buildings"],
      processId: "breinstein-buildings",
    });
    expect(only?.kind).toBe("json");
  });
});

describe("the reference arm, from ZOO-Project", () => {
  it("reads two bare { href } entries, with no media type to report", async () => {
    const envelope = envelopeOf(
      "zoo-project/execution/echo-reference.http",
      `${ZOO}/echo/execution`,
    );
    const results = await toRenderable(envelope, {
      outputIds: ["a", "b", "c", "pause"],
      processId: "echo",
    });
    expect(results).toEqual([
      {
        kind: "reference",
        outputId: "a",
        href: "http://localhost:5090/temp//ZOO_DATA_echo_a_79756b8e-b9e2-11f1-9d7f-3a9d4c7adc78_0.txt",
      },
      {
        kind: "reference",
        outputId: "c",
        href: "http://localhost:5090/temp//ZOO_DATA_echo_c_79756b8e-b9e2-11f1-9d7f-3a9d4c7adc78_1.txt",
      },
    ]);
  });

  it("takes the media type from format.mediaType when there is no type", async () => {
    const envelope = envelopeOf(
      "zoo-project/execution/buffer-reference-gml.http",
      `${ZOO}/Buffer/execution`,
    );
    const [result] = await toRenderable(envelope, { outputIds: ["Result"], processId: "Buffer" });
    expect(result).toMatchObject({ kind: "reference", mediaType: "text/xml" });
    expect(result).not.toHaveProperty("rel");
  });

  it("reads Buffer's JSON link, which says nothing of its type", async () => {
    const envelope = envelopeOf(
      "zoo-project/execution/buffer-reference-json.http",
      `${ZOO}/Buffer/execution`,
    );
    const [result] = await toRenderable(envelope, { outputIds: ["Result"], processId: "Buffer" });
    expect(result).toMatchObject({ kind: "reference" });
    expect(result).not.toHaveProperty("mediaType");
    expect(result?.kind === "reference" && result.href.endsWith(".js")).toBe(true);
  });

  it("prefers the link's own type to format.mediaType when both are there", async () => {
    const envelope = envelopeOf(
      "zoo-project/execution/saga-fractals-reference-wfs.http",
      `${ZOO}/SAGA.garden_fractals.1/execution`,
    );
    const [result] = await toRenderable(envelope, {
      outputIds: ["RESULT"],
      processId: "SAGA.garden_fractals.1",
    });
    expect(result).toMatchObject({ kind: "reference", mediaType: "text/xml" });
    expect(result?.kind === "reference" && result.href).toContain("/cgi-bin/mapserv?");
  });

  it("splits a single output that is only a link", async () => {
    const envelope = envelopeOf(
      "zoo-project/execution/hellopy-reference.http",
      `${ZOO}/HelloPy/execution`,
    );
    const [result] = await toRenderable(envelope, { outputIds: ["Result"], processId: "HelloPy" });
    expect(result).toMatchObject({ kind: "reference", outputId: "Result" });
  });
});

describe("href resolution", () => {
  function served(body: unknown, url: string) {
    return createEnvelope(
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
      { requestedUrl: url },
    );
  }

  it("resolves a relative href against the URL the results were served from", async () => {
    const [result] = await toRenderable(
      served({ out: { href: "files/out.tif" } }, "http://x.test/jobs/1/results/"),
      { outputIds: ["out"], processId: "p" },
    );
    expect(result).toMatchObject({
      kind: "reference",
      href: "http://x.test/jobs/1/results/files/out.tif",
    });
  });

  it("resolves a root-relative href against that URL's origin, not by concatenation", async () => {
    const [result] = await toRenderable(
      served({ out: { href: "/temp//a.txt" } }, "http://x.test/ogc-api/jobs/1/results"),
      { outputIds: ["out"], processId: "p" },
    );
    expect(result).toMatchObject({ href: "http://x.test/temp//a.txt" });
  });

  it("keeps an entry with both href and value a value", async () => {
    const [result] = await toRenderable(
      served({ out: { href: "x", value: "y", mediaType: "text/plain" } }, "http://x.test/r"),
      { outputIds: ["out"], processId: "p" },
    );
    expect(result?.kind).toBe("text");
  });

  it("never turns a reference into a download for being large", async () => {
    const href = `https://x.test/${"a".repeat(2000)}`;
    const [result] = await toRenderable(served({ out: { href } }, "http://x.test/r"), {
      outputIds: ["out"],
      processId: "p",
      displayLimitBytes: 100,
    });
    expect(result).toMatchObject({ kind: "reference", href });
  });
});
