/**
 * One entry of the `processes` array → a `ProcessSummary`, against both
 * reference servers' real payloads and against the malformations the tolerance
 * policy has to survive.
 */

import { describe, expect, it } from "vitest";
import pygeoapiList from "../fixtures/pygeoapi/process-list.json" with { type: "json" };
import zooList from "../fixtures/zoo-project/process-list-limit20.json" with { type: "json" };
import { MalformedProcessDocumentError } from "../../src/errors.js";
import { createReport, deriveExecution, parseSummary } from "../../src/processes/parse-summary.js";
import { findLink } from "../../src/links/find.js";

const PYGEOAPI = "http://localhost:5080/processes";
const ZOO = "http://localhost:5090/ogc-api/processes";

function parse(entry: unknown, documentUrl = PYGEOAPI) {
  const report = createReport();
  const summary = parseSummary(entry, { documentUrl, where: "entry at index 0", report });
  return { summary, report };
}

describe("parseSummary against real payloads", () => {
  it("parses pygeoapi 0.21.0's hello-world entry", () => {
    const { summary, report } = parse(pygeoapiList.processes[0]);

    expect(summary.id).toBe("hello-world");
    expect(summary.title).toBe("Hello World");
    expect(summary.version).toBe("0.2.0");
    expect(summary.keywords).toEqual(["hello world", "example", "echo"]);
    expect(summary.outputTransmission).toEqual(["value"]);
    expect(summary.execution).toEqual({
      sync: true,
      async: true,
      // pygeoapi declares sync and async but not dismiss, which matches
      // finding 0006 from the other direction.
      dismiss: false,
      declared: ["sync-execute", "async-execute"],
      defaulted: false,
    });
    expect(report.warnings).toEqual([]);
    expect([...report.unrecognisedKeys]).toEqual([]);
  });

  it("resolves a pygeoapi entry's own self link, which points at the description", () => {
    const { summary } = parse(pygeoapiList.processes[0]);

    expect(findLink(summary.links, "self")?.href).toBe(
      "http://localhost:5080/processes/hello-world?f=json",
    );
  });

  it("parses every ZOO entry, and each one advertises its own description", () => {
    // Finding 0017 says ZOO's process *descriptions* carry no `self`. Its list
    // *entries* do — checked here against all twenty of the captured page, and
    // against all 703 live on 2026-08-31.
    const summaries = zooList.processes.map((entry, index) => {
      const report = createReport();
      return parseSummary(entry, {
        documentUrl: ZOO,
        where: `entry at index ${String(index)}`,
        report,
      });
    });

    expect(summaries).toHaveLength(20);
    expect(summaries[0]?.id).toBe("hellojs");
    for (const summary of summaries) {
      expect(findLink(summary.links, "self")?.href).toBe(`${ZOO}/${summary.id}`);
      expect(summary.execution).toMatchObject({
        sync: true,
        async: true,
        dismiss: true,
        defaulted: false,
      });
    }
  });

  it("records ZOO's unmodelled members by name and keeps them out of the result", () => {
    const { summary, report } = parse(zooList.processes[0], ZOO);

    // `mutable` is OGC Part 2, `metadata` is Common. Neither is modelled here;
    // both are the early-warning signal the observation exists for.
    expect([...report.unrecognisedKeys].sort()).toEqual(["metadata", "mutable"]);
    expect(summary).not.toHaveProperty("mutable");
    expect(summary).not.toHaveProperty("metadata");
  });
});

describe("deriveExecution", () => {
  it("applies the OGC sync-only default when nothing is declared, and says so", () => {
    const report = createReport();

    expect(deriveExecution(undefined, report)).toEqual({
      sync: true,
      async: false,
      dismiss: false,
      declared: [],
      defaulted: true,
    });
    expect(report.warnings).toContain("job-control-options-absent");
  });

  it("reports all three when the server declares all three", () => {
    const report = createReport();

    expect(deriveExecution(["sync-execute", "async-execute", "dismiss"], report)).toEqual({
      sync: true,
      async: true,
      dismiss: true,
      declared: ["sync-execute", "async-execute", "dismiss"],
      defaulted: false,
    });
    expect(report.warnings).toEqual([]);
  });

  it("treats an explicitly empty array as a declaration of nothing, still defaulted", () => {
    const report = createReport();

    expect(deriveExecution([], report)).toMatchObject({ defaulted: true, sync: true });
    expect(report.warnings).toContain("job-control-options-declared-empty");
  });

  it("keeps an unrecognised option verbatim in `declared` without inventing a boolean", () => {
    const report = createReport();
    const execution = deriveExecution(["sync-execute", "vendor-magic"], report);

    expect(execution.declared).toEqual(["sync-execute", "vendor-magic"]);
    expect(execution).toMatchObject({ sync: true, async: false, defaulted: false });
  });
});

describe("parseSummary tolerance", () => {
  it("throws with the index in the message when `id` is missing", () => {
    expect(() => parse({ title: "no id here" })).toThrow(MalformedProcessDocumentError);
    expect(() => parse({ title: "no id here" })).toThrow(/entry at index 0/);
    expect(() => parse({ title: "no id here" })).toThrow(/no `id` member/);
  });

  it("throws when `id` is a number rather than coercing it", () => {
    expect(() => parse({ id: 7 })).toThrow(/`id` is number, not a string/);
  });

  it("throws when the entry is not an object at all", () => {
    expect(() => parse(["not", "an", "entry"])).toThrow(/expected a JSON object, got an array/);
    expect(() => parse("hello-world")).toThrow(/got string/);
  });

  it("degrades a missing version into a usable summary plus a warning", () => {
    const { summary, report } = parse({ id: "p", jobControlOptions: ["sync-execute"] });

    expect(summary.id).toBe("p");
    expect(summary).not.toHaveProperty("version");
    expect(report.warnings).toContain("version-absent");
  });

  it("accepts keywords sent as a bare string, and records that it was", () => {
    const { summary, report } = parse({ id: "p", version: "1", keywords: "geospatial" });

    expect(summary.keywords).toEqual(["geospatial"]);
    expect(report.warnings).toContain("keywords-is-a-string-not-an-array");
  });

  it("drops non-string keyword entries rather than the whole list", () => {
    const { summary, report } = parse({ id: "p", version: "1", keywords: ["ok", 3, null] });

    expect(summary.keywords).toEqual(["ok"]);
    expect(report.warnings).toContain("keywords-has-non-string-entries");
  });

  it("survives a `links` member that is not an array", () => {
    const { summary } = parse({ id: "p", version: "1", links: "over there" });

    expect(summary.links).toEqual([]);
  });

  it("skips a malformed link without losing the good ones", () => {
    const { summary } = parse({
      id: "p",
      version: "1",
      links: [{ rel: "self", href: "p" }, { rel: "next" }, "nonsense"],
    });

    expect(summary.links).toHaveLength(1);
    expect(summary.links[0]?.href).toBe("http://localhost:5080/p");
  });
});
