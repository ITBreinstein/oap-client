/**
 * Task 8, T9: one `result` record per output when the result is shown, and a
 * second, appended, when a reference is loaded — redacted at creation.
 */

import { describe, expect, it } from "vitest";
import { loadedObservation, resultObservations, type RunFacts } from "../src/observations.js";
import type { LoadedReference } from "../src/results/reference.js";
import type { RenderableResult } from "../src/results/renderable.js";

const SECRET_PATH = "private-folder/user-7731";
const SECRET_QUERY = "token=s3cr3t&bbox=5.118,52.089";

const run: RunFacts = {
  runId: "5f0c2a4e-1d7b-4c52-9d1f-3a2b8e6c9d01",
  endpoint: `http://localhost:5080/?${SECRET_QUERY}`,
  processId: "breinstein-buildings",
  declaredTransmission: ["value"],
  linkOutputs: ["buildings"],
};

const reference: Extract<RenderableResult, { kind: "reference" }> = {
  kind: "reference",
  outputId: "buildings",
  href: `https://api.pdok.nl/${SECRET_PATH}/items?${SECRET_QUERY}`,
  mediaType: "application/geo+json",
  rel: "related",
};

const loaded: LoadedReference = {
  outcome: "ok",
  route: "direct",
  representation: "geojson",
  mediaType: "application/geo+json",
  status: undefined,
  detail: undefined,
  blob: new Blob(["{}"]),
  geojson: { type: "FeatureCollection", features: [] },
  contentCrs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  axes: "as-is",
  page: { returned: 10, matched: undefined, hasNext: true },
  itemsUrl: undefined,
};

describe("result observations", () => {
  it("writes one record per output as the result is shown", () => {
    const records = resultObservations(run, [
      reference,
      { kind: "text", outputId: "table", value: "a,b", mediaType: "text/csv" },
    ]);
    expect(records).toEqual([
      {
        kind: "result",
        runId: run.runId,
        endpoint: "http://localhost:5080/",
        processId: "breinstein-buildings",
        outputId: "buildings",
        declaredTransmission: ["value"],
        requestedTransmission: "reference",
        receivedAs: "reference",
        mediaType: "application/geo+json",
        renderedAs: "reference",
        referenceOrigin: "https://api.pdok.nl",
        referenceRoute: undefined,
        referenceOutcome: "not-followed",
        representation: undefined,
        truncated: undefined,
        contentCrs: undefined,
        axisSwapped: undefined,
      },
      expect.objectContaining({
        outputId: "table",
        requestedTransmission: "unspecified",
        receivedAs: "value",
        mediaType: "text/csv",
        renderedAs: "text",
        referenceOrigin: undefined,
        referenceOutcome: undefined,
      }),
    ]);
  });

  it("appends what Load found as a second record, leaving the first alone", () => {
    const [first] = resultObservations(run, [reference]);
    const second = loadedObservation(run, reference, loaded);
    expect(second).toMatchObject({
      runId: first?.runId,
      outputId: "buildings",
      referenceRoute: "direct",
      referenceOutcome: "ok",
      representation: "geojson",
      truncated: true,
      contentCrs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      axisSwapped: false,
    });
    expect(first?.referenceOutcome).toBe("not-followed");
  });

  it("records a swap, and a blocked Load with nothing read", () => {
    expect(loadedObservation(run, reference, { ...loaded, axes: "swapped" }).axisSwapped).toBe(
      true,
    );
    const blocked = loadedObservation(run, reference, {
      ...loaded,
      outcome: "cors-blocked",
      representation: undefined,
      mediaType: undefined,
      blob: undefined,
      geojson: undefined,
      contentCrs: undefined,
      axes: undefined,
      page: undefined,
    });
    expect(blocked).toMatchObject({
      referenceOutcome: "cors-blocked",
      truncated: undefined,
      axisSwapped: undefined,
    });
  });

  it("never carries a reference's path or query, or the endpoint's query", () => {
    const text = JSON.stringify([
      ...resultObservations(run, [reference]),
      loadedObservation(run, reference, {
        ...loaded,
        itemsUrl: `https://api.pdok.nl/${SECRET_PATH}?${SECRET_QUERY}`,
      }),
    ]);
    expect(text).not.toContain("private-folder");
    expect(text).not.toContain("user-7731");
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("bbox");
    expect(text).not.toContain("/items");
  });

  it("gives no origin for an href that is not http or https", () => {
    const [record] = resultObservations(run, [{ ...reference, href: "data:text/plain,secret" }]);
    expect(record?.referenceOrigin).toBeUndefined();
  });
});
