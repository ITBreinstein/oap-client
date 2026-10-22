/**
 * Finding a place in the Netherlands for the map (#16): PDOK's Locatieserver
 * (Kadaster), its `suggest` as the visitor types, then its `lookup` for the
 * one chosen. Not OGC API - Processes, so not the core's to send: like the
 * page's other small clients (`config.json`, the relay), it calls `fetch`
 * itself, through one that can be handed in for a test.
 *
 * What is sent: the words typed, and the id of the place chosen. Nothing
 * else of the page. The answers are checked field by field, never asserted
 * into shape: they come from another host.
 */

const BASE = "https://api.pdok.nl/bzk/locatieserver/search/v3_1";

/** How many suggestions to ask for: a short list to choose from. */
export const SUGGESTIONS = 6;

export type PlaceFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One suggestion: what the list shows, and how to look it up. */
export interface PlaceSuggestion {
  readonly id: string;
  /** "Amersfoort, Amersfoort, Utrecht". */
  readonly name: string;
  /** Locatieserver's kind: gemeente, woonplaats, weg, postcode, adres, … */
  readonly type: string;
}

/** A place found: where to show it. */
export interface Place {
  readonly name: string;
  /** West, south, east, north, in longitude and latitude. */
  readonly extent: readonly [number, number, number, number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `response.docs` of a Locatieserver answer, as records; empty when it is not one. */
function docsOf(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body)) return [];
  const response = body["response"];
  if (!isRecord(response)) return [];
  const docs = response["docs"];
  return Array.isArray(docs) ? docs.filter(isRecord) : [];
}

/** The suggestions in a `suggest` answer; those without an id or a name are left out. */
export function parseSuggestions(body: unknown): PlaceSuggestion[] {
  return docsOf(body).flatMap((doc) => {
    const { id, weergavenaam, type } = doc;
    return typeof id === "string" && id !== "" && typeof weergavenaam === "string"
      ? [{ id, name: weergavenaam, type: typeof type === "string" ? type : "" }]
      : [];
  });
}

/** Every `x y` pair in WKT, in order. */
function positionsInWkt(wkt: string): [number, number][] {
  const pairs: [number, number][] = [];
  for (const match of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  return pairs;
}

/**
 * The extent of WKT in longitude and latitude: a point's is the point
 * itself. Undefined when it holds nothing in range.
 */
export function wktExtent(wkt: string): [number, number, number, number] | undefined {
  const positions = positionsInWkt(wkt).filter(
    ([x, y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90,
  );
  if (positions.length === 0) return undefined;
  let [west, south] = positions[0] ?? [0, 0];
  let [east, north] = [west, south];
  for (const [x, y] of positions) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  return [west, south, east, north];
}

/**
 * The place in a `lookup` answer: its outline's extent when it has one (a
 * municipality, a town, a road), else its centre's.
 */
export function parsePlace(body: unknown): Place | undefined {
  const [doc] = docsOf(body);
  if (doc === undefined) return undefined;
  const { weergavenaam, geometrie_ll: outline, centroide_ll: centre } = doc;
  if (typeof weergavenaam !== "string") return undefined;
  const extent =
    (typeof outline === "string" ? wktExtent(outline) : undefined) ??
    (typeof centre === "string" ? wktExtent(centre) : undefined);
  return extent === undefined ? undefined : { name: weergavenaam, extent };
}

export interface PlaceSearch {
  suggest(words: string, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
  lookup(id: string, signal?: AbortSignal): Promise<Place | undefined>;
}

async function read(fetchImpl: PlaceFetch, url: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(url.toString(), {
    credentials: "omit",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`PDOK Locatieserver answered HTTP ${String(response.status)}`);
  return response.json();
}

export function createPlaceSearch(
  fetchImpl: PlaceFetch = (input, init) => fetch(input, init),
): PlaceSearch {
  return {
    async suggest(words, signal) {
      const url = new URL(`${BASE}/suggest`);
      url.searchParams.set("q", words);
      url.searchParams.set("rows", String(SUGGESTIONS));
      return parseSuggestions(await read(fetchImpl, url, signal));
    },
    async lookup(id, signal) {
      const url = new URL(`${BASE}/lookup`);
      url.searchParams.set("id", id);
      url.searchParams.set("fl", "id,weergavenaam,type,centroide_ll,geometrie_ll");
      return parsePlace(await read(fetchImpl, url, signal));
    },
  };
}
