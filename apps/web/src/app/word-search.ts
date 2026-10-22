/**
 * The search fields' matching (#9): every word typed, in any order, found
 * somewhere in what is searched, whatever its case. "amsterdam buildings"
 * finds "Buildings in an area" when its summary says Amsterdam.
 */

/** The words of a query, lower case; none for an empty one. */
export function queryWords(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

/** Whether every word of `query` is in one of `texts`. An empty query matches all. */
export function matchesWords(query: string, texts: readonly string[]): boolean {
  const haystack = texts.join("\n").toLowerCase();
  return queryWords(query).every((word) => haystack.includes(word));
}
