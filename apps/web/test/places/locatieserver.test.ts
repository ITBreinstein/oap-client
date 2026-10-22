/**
 * #16: PDOK Locatieserver's answers, checked field by field, and what is
 * asked of it.
 */

import { describe, expect, it } from "vitest";
import {
  createPlaceSearch,
  parsePlace,
  parseSuggestions,
  SUGGESTIONS,
  wktExtent,
} from "../../src/places/locatieserver.js";

/** As PDOK answered `suggest?q=amersfoort` on 2026-10-22. */
const SUGGEST = {
  response: {
    numFound: 88341,
    start: 0,
    maxScore: 10.05,
    numFoundExact: true,
    docs: [
      {
        type: "gemeente",
        weergavenaam: "Gemeente Amersfoort",
        id: "gem-cceb0170170bb0dce737a135e1100ce5",
        score: 10.05,
      },
      {
        type: "woonplaats",
        weergavenaam: "Amersfoort, Amersfoort, Utrecht",
        id: "wpl-f31266cefb205e1ce873f4dc2c68315d",
        score: 8.69,
      },
    ],
  },
  highlighting: {},
  spellcheck: {},
};

describe("parseSuggestions", () => {
  it("reads each suggestion's id, name and kind", () => {
    expect(parseSuggestions(SUGGEST)).toEqual([
      { id: "gem-cceb0170170bb0dce737a135e1100ce5", name: "Gemeente Amersfoort", type: "gemeente" },
      {
        id: "wpl-f31266cefb205e1ce873f4dc2c68315d",
        name: "Amersfoort, Amersfoort, Utrecht",
        type: "woonplaats",
      },
    ]);
  });

  it("leaves out what has no id or name, and is empty for anything else", () => {
    expect(
      parseSuggestions({ response: { docs: [{ weergavenaam: "x" }, { id: "y" }, null, 3] } }),
    ).toEqual([]);
    expect(parseSuggestions({ response: { docs: "none" } })).toEqual([]);
    expect(parseSuggestions("<html>")).toEqual([]);
    expect(parseSuggestions(null)).toEqual([]);
  });
});

describe("wktExtent", () => {
  it("is a point's own position", () => {
    expect(wktExtent("POINT(5.38469621 52.17364981)")).toEqual([
      5.38469621, 52.17364981, 5.38469621, 52.17364981,
    ]);
  });

  it("is around every position of a multipolygon", () => {
    expect(
      wktExtent(
        "MULTIPOLYGON(((5.31 52.10,5.45 52.12,5.40 52.25,5.31 52.10)),((5.5 52.3,5.51 52.31,5.5 52.3)))",
      ),
    ).toEqual([5.31, 52.1, 5.51, 52.31]);
  });

  it("is nothing without positions in longitude and latitude", () => {
    expect(wktExtent("POINT EMPTY")).toBeUndefined();
    expect(wktExtent("POINT(155000 463000)")).toBeUndefined();
  });
});

describe("parsePlace", () => {
  it("takes the outline's extent when there is one", () => {
    expect(
      parsePlace({
        response: {
          docs: [
            {
              weergavenaam: "Gemeente Amersfoort",
              centroide_ll: "POINT(5.38 52.17)",
              geometrie_ll: "MULTIPOLYGON(((5.31 52.10,5.45 52.12,5.40 52.25,5.31 52.10)))",
            },
          ],
        },
      }),
    ).toEqual({ name: "Gemeente Amersfoort", extent: [5.31, 52.1, 5.45, 52.25] });
  });

  it("takes the centre for an address", () => {
    expect(
      parsePlace({
        response: {
          docs: [{ weergavenaam: "Kleine Spui 32, Amersfoort", centroide_ll: "POINT(5.38 52.16)" }],
        },
      }),
    ).toEqual({ name: "Kleine Spui 32, Amersfoort", extent: [5.38, 52.16, 5.38, 52.16] });
  });

  it("is nothing without a name or a place", () => {
    expect(parsePlace({ response: { docs: [{ centroide_ll: "POINT(5 52)" }] } })).toBeUndefined();
    expect(parsePlace({ response: { docs: [{ weergavenaam: "x" }] } })).toBeUndefined();
    expect(parsePlace({ response: { docs: [] } })).toBeUndefined();
  });
});

describe("createPlaceSearch", () => {
  it("sends the words typed, and nothing else, to suggest", async () => {
    const asked: string[] = [];
    const search = createPlaceSearch((input) => {
      asked.push(input);
      return Promise.resolve(Response.json(SUGGEST));
    });
    const found = await search.suggest("amers foort");
    expect(found).toHaveLength(2);
    const url = new URL(asked[0] ?? "");
    expect(url.origin + url.pathname).toBe(
      "https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest",
    );
    expect([...url.searchParams]).toEqual([
      ["q", "amers foort"],
      ["rows", String(SUGGESTIONS)],
    ]);
  });

  it("looks a place up by its id", async () => {
    const asked: string[] = [];
    const search = createPlaceSearch((input) => {
      asked.push(input);
      return Promise.resolve(
        Response.json({ response: { docs: [{ weergavenaam: "A", centroide_ll: "POINT(5 52)" }] } }),
      );
    });
    expect(await search.lookup("adr-1")).toEqual({ name: "A", extent: [5, 52, 5, 52] });
    expect(new URL(asked[0] ?? "").searchParams.get("id")).toBe("adr-1");
  });

  it("says so when PDOK refuses", async () => {
    const search = createPlaceSearch(() => Promise.resolve(new Response("", { status: 503 })));
    await expect(search.suggest("x")).rejects.toThrow("PDOK Locatieserver answered HTTP 503");
  });
});
