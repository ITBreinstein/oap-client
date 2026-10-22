/**
 * #26: a CSV result is read into rows for a table, and every text result
 * downloads with its media type's extension.
 */

import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/results/csv.js";
import { isCsv, textFilename } from "../../src/results/renderable.js";

describe("parseCsv", () => {
  it("reads rows and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("takes CRLF and LF alike, and a last record without a line break", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("reads quoted fields with commas, line breaks and doubled quotes", () => {
    expect(parseCsv('name,note\n"Plot, north","two\nlines"\n"say ""hi""",x\n')).toEqual([
      ["name", "note"],
      ["Plot, north", "two\nlines"],
      ['say "hi"', "x"],
    ]);
  });

  it("keeps empty fields, and a quoted empty field", () => {
    expect(parseCsv('1,,Polygon\n"",b,\n')).toEqual([
      ["1", "", "Polygon"],
      ["", "b", ""],
    ]);
  });

  it("reads breinstein-feature-area's table as the server sends it", () => {
    const text =
      'number,id,geometry,area_m2,name\n1,,Polygon,380706.59,"Plot, north"\n2,,Polygon,190395.63,"Plot, south"\n';
    expect(parseCsv(text)).toEqual([
      ["number", "id", "geometry", "area_m2", "name"],
      ["1", "", "Polygon", "380706.59", "Plot, north"],
      ["2", "", "Polygon", "190395.63", "Plot, south"],
    ]);
  });

  it("is nothing for empty text", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("is not a table when a quote is left open, or text follows a closing quote", () => {
    expect(parseCsv('a,"b\n1,2')).toBeUndefined();
    expect(parseCsv('"a"b,c')).toBeUndefined();
  });
});

describe("textFilename", () => {
  it("names a CSV .csv", () => {
    expect(textFilename("breinstein-feature-area", "table", "text/csv")).toBe(
      "breinstein-feature-area-table.csv",
    );
  });

  it("reads the media type without its parameters, in any case", () => {
    expect(textFilename("p", "o", "Text/CSV; charset=utf-8")).toBe("p-o.csv");
    expect(textFilename("p", "o", "application/xml")).toBe("p-o.xml");
    expect(textFilename("p", "o", "text/html")).toBe("p-o.html");
  });

  it("falls back to .txt for a type the map does not know", () => {
    expect(textFilename("p", "o", "text/plain")).toBe("p-o.txt");
    expect(textFilename("p", "o", "text/x-unknown")).toBe("p-o.txt");
    expect(textFilename("p", "o", "application/vnd.example+xml")).toBe("p-o.txt");
  });
});

describe("isCsv", () => {
  it("knows CSV with or without parameters", () => {
    expect(isCsv("text/csv")).toBe(true);
    expect(isCsv("text/csv; header=present")).toBe(true);
    expect(isCsv("text/plain")).toBe(false);
    expect(isCsv(undefined)).toBe(false);
  });
});
