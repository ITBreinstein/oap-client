/**
 * `getResults()` — routing, and the promise not to parse.
 *
 * Reduction tests this file backs:
 *  1. making `getResults()` parse JSON and return the body → the "returns the
 *     envelope unparsed" tests go red. *(T3)*
 *  2. dropping the advertised-link preference → the routing test goes red.
 */

import { describe, expect, it } from "vitest";
import { getResults, resolveResultsUrl } from "../../src/jobs/get-results.js";
import { parseJobStatus } from "../../src/jobs/parse-status.js";
import { ProcessesError } from "../../src/http/errors.js";
import type { Observation } from "../../src/observations.js";

const JOB_URL = "https://service.test/oapi/jobs/abc";

function collect(): { sink: (o: Observation) => void; seen: Observation[] } {
  const seen: Observation[] = [];
  return { sink: (o) => seen.push(o), seen };
}

function fetchRecording(response: Response): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  urls: string[];
  accepts: (string | undefined)[];
} {
  const urls: string[] = [];
  const accepts: (string | undefined)[] = [];
  return {
    urls,
    accepts,
    fetch: (url: string, init: RequestInit = {}) => {
      urls.push(url);
      accepts.push(new Headers(init.headers).get("Accept") ?? undefined);
      return Promise.resolve(response.clone());
    },
  };
}

describe("routing — T3", () => {
  it("prefers the advertised results link over a constructed path", () => {
    // pygeoapi's real shape, captured 2026-09-16: the relation appears three
    // times on a running job, once per representation. Only the long OGC URI
    // form is used — neither server writes the short `results`.
    const status = parseJobStatus(
      {
        jobID: "abc",
        status: "successful",
        links: [
          {
            href: "https://service.test/oapi/jobs/abc/results?f=html",
            rel: "http://www.opengis.net/def/rel/ogc/1.0/results",
            type: "text/html",
          },
          {
            href: "https://service.test/oapi/jobs/abc/results?f=json",
            rel: "http://www.opengis.net/def/rel/ogc/1.0/results",
            type: "application/json",
          },
        ],
      },
      { documentUrl: JOB_URL },
    );

    const routed = resolveResultsUrl(JOB_URL, status.links);

    expect(routed.route).toBe("advertised-link");
    // The media-type scoring picks JSON over the HTML sibling — the same bug
    // `findLink` was written to prevent on `alternate`.
    expect(routed.url).toBe("https://service.test/oapi/jobs/abc/results?f=json");
  });

  it("constructs {statusUrl}/results when nothing is advertised", () => {
    const routed = resolveResultsUrl(JOB_URL, []);

    expect(routed.route).toBe("constructed-path");
    expect(routed.url).toBe("https://service.test/oapi/jobs/abc/results");
  });

  it("appends to the path, not the query, for a job URL carrying ?f=json", () => {
    // The live trap: a job URL reached through the `?f=json` fallback ends in a
    // query, and appending there would land the guess one level too high.
    const routed = resolveResultsUrl("https://service.test/oapi/jobs/abc?f=json", []);

    expect(routed.url).toBe("https://service.test/oapi/jobs/abc/results");
  });
});

describe("the envelope comes back unparsed — T3", () => {
  it("hands over a non-JSON result with filename and Content-Crs intact", async () => {
    const png = new Response("PNG-BYTES-STAND-IN", {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="result.png"',
        "Content-Crs": "<http://www.opengis.net/def/crs/OGC/1.3/CRS84>",
      },
    });
    const fake = fetchRecording(png);

    const results = await getResults(JOB_URL, { fetch: fake.fetch });

    // The reduction test: make this function parse JSON and this whole block
    // becomes impossible — a PNG has no JSON to return.
    expect(results.envelope.mediaType).toBe("image/png");
    expect(results.envelope.filename).toBe("result.png");
    expect(results.envelope.contentCrs).toBe("<http://www.opengis.net/def/crs/OGC/1.3/CRS84>");
    expect(results.route).toBe("constructed-path");
    // Still readable, and readable more than once.
    expect(await results.envelope.text()).toContain("PNG");
    expect(await results.envelope.text()).toContain("PNG");
  });

  it("hands over a JSON result without interpreting its shape", async () => {
    // ZOO's real results body, captured 2026-09-16: keyed by output id. The
    // point of the test is that this layer does not care — pygeoapi's is
    // `{"id":…,"value":…}` and both arrive unchanged.
    const body = { Result: "Long process run successfully" };
    const fake = fetchRecording(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json;charset=UTF-8" },
      }),
    );

    const results = await getResults(JOB_URL, { fetch: fake.fetch });

    expect(results.envelope.isJson).toBe(true);
    expect(await results.envelope.json()).toEqual(body);
  });
});

describe("content negotiation — finding 0036", () => {
  it("states a JSON preference while still accepting a binary result", async () => {
    // Against pygeoapi a bare `*/*` returns `text/html` on this endpoint, which
    // is why the brief's prescribed header was changed. The `q=0.8` keeps a PNG
    // or a zip acceptable.
    const fake = fetchRecording(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await getResults(JOB_URL, { fetch: fake.fetch });

    expect(fake.accepts[0]).toBe("application/json, */*;q=0.8");
  });
});

describe("refusals", () => {
  it("throws for pygeoapi's 404 on a job whose result is not ready", async () => {
    const body = {
      code: "ResultNotReady",
      type: "ResultNotReady",
      description: "job accepted but not yet running",
    };
    const fake = fetchRecording(
      new Response(JSON.stringify(body), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getResults(JOB_URL, { fetch: fake.fetch })).rejects.toBeInstanceOf(ProcessesError);
  });

  it("records the failed attempt as an observation before throwing", async () => {
    const { sink, seen } = collect();
    const fake = fetchRecording(
      new Response("{}", { status: 400, headers: { "Content-Type": "application/json" } }),
    );

    await expect(
      getResults(JOB_URL, { fetch: fake.fetch, onObservation: sink }),
    ).rejects.toBeInstanceOf(ProcessesError);

    expect(seen.find((entry) => entry.kind === "job-results")).toMatchObject({
      ok: false,
      status: 400,
      route: "constructed-path",
    });
  });
});
