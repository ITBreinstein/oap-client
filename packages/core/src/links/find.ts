/**
 * Finding a link by relation, with a media-type preference that keeps us out of
 * the HTML branch of a content-negotiating server.
 */

import { MissingLinkError } from "../errors.js";
import { isJsonMediaType, parseMediaType } from "../http/media-type.js";
import { matchesRelation, type KnownRelation } from "./types.js";
import type { Link } from "./types.js";

const EMPTY_LINKS: readonly Link[] = Object.freeze([]);

/**
 * Higher is better. The ordering, and why step 3 beats step 4:
 *
 * 3 — `application/json` exactly: unambiguously what we want.
 * 2 — any `+json` structured suffix, e.g. `application/vnd.oai.openapi+json`.
 *     Parsed rather than string-matched, because real types carry parameters
 *     (`;version=3.0`) that a naive `endsWith("+json")` misses.
 * 1 — no declared type at all: unknown, but *plausibly* JSON.
 * 0 — a declared non-JSON type, e.g. `text/html`: known to be wrong.
 *
 * An untyped link outranking a `text/html` one is the whole point. pygeoapi
 * advertises `alternate` twice — once as HTML, once as JSON-LD — and returning
 * the HTML sibling when a JSON one exists is precisely the bug this prevents.
 */
function score(link: Link): number {
  if (link.type === undefined) return 1;
  const { mediaType } = parseMediaType(link.type);
  if (mediaType === undefined) return 1; // unparseable is no better informed than absent
  if (mediaType === "application/json") return 3;
  return isJsonMediaType(mediaType) ? 2 : 0;
}

/** Every link carrying the relation, in document order. */
export function findLinks(links: readonly Link[], relation: KnownRelation): readonly Link[] {
  const matches = links.filter((link) => matchesRelation(link.rel, relation));
  return matches.length === 0 ? EMPTY_LINKS : Object.freeze(matches);
}

/**
 * The best link for the relation, or `undefined` if none carries it.
 *
 * "Best" is {@link score}, ties broken by document order — a server that lists
 * two equally good candidates has told us it does not mind which.
 */
export function findLink(links: readonly Link[], relation: KnownRelation): Link | undefined {
  let best: Link | undefined;
  let bestScore = -1;

  for (const link of links) {
    if (!matchesRelation(link.rel, relation)) continue;
    const candidate = score(link);
    if (candidate > bestScore) {
      best = link;
      bestScore = candidate;
    }
  }

  return best;
}

/**
 * {@link findLink}, but the absence of the relation is an error.
 *
 * For operations with no path fallback to degrade to. Discovery does *not* use
 * this for `conformance` — a missing conformance link falls back to
 * `./conformance` and is recorded as a finding rather than raised.
 */
export function requireLink(
  links: readonly Link[],
  relation: KnownRelation,
  documentUrl: string,
): Link {
  const link = findLink(links, relation);
  if (link === undefined) throw new MissingLinkError(relation, documentUrl);
  return link;
}
