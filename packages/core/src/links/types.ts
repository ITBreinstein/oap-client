/**
 * Link relations, and the alias table that makes matching them survive contact
 * with real servers.
 */

export interface Link {
  /** Always absolute: resolved against the URL the carrying document came from. */
  readonly href: string;
  readonly rel: string;
  readonly type?: string;
  readonly hreflang?: string;
  readonly title?: string;
}

/**
 * OGC registers its own relations as full URIs, and IANA registers short names.
 * Servers pick one, the other, or both, and *which* one is not predictable per
 * relation — so every lookup has to try the whole set.
 *
 * Verified 2026-08-26 against OGC API - Processes Part 1 v1.0 (18-062r2 §5.2)
 * and against a live pygeoapi 0.21.0, whose landing page is captured in
 * `test/fixtures/pygeoapi/landing-page.json`. What that comparison showed:
 *
 * - The standard's normative relation for **conformance** is the long URI, but
 *   pygeoapi emits only the short `conformance`.
 * - The standard's normative relation for **processes** is also the long URI,
 *   and pygeoapi emits only that — never the short `processes`.
 *
 * So the two relations that matter most disagree in opposite directions on the
 * same server. Neither form alone would have found both. This table is not
 * defensive programming; it is the minimum that works.
 */
/**
 * The relations this layer can look up.
 *
 * The obvious way to write this is `keyof typeof REL_ALIASES` over an
 * `as const satisfies` table, so that the table and the list of legal arguments
 * are literally one declaration. That does not survive this package's
 * `isolatedDeclarations: true`: the table would leak into the emitted `.d.ts`
 * through `keyof`, and TS9010 demands an explicit annotation on it — but
 * annotating it `Record<string, readonly string[]>` widens the keys back to
 * `string` and destroys the very union we wanted.
 *
 * Declaring the union first and annotating the table with
 * `Record<KnownRelation, …>` buys the same guarantee from the other direction.
 * `Record` is exhaustive, so a relation added here and forgotten in the table
 * is a compile error, and a table key that is not in the union is a compile
 * error too. The two still cannot drift; only the direction of the check moved.
 */
export type KnownRelation =
  | "self"
  | "alternate"
  | "serviceDesc"
  | "conformance"
  | "processes"
  | "next"
  | "prev"
  | "execute"
  | "monitor";

const REL_ALIASES: Readonly<Record<KnownRelation, readonly string[]>> = {
  self: ["self"],
  alternate: ["alternate"],
  serviceDesc: ["service-desc"],
  conformance: ["conformance", "http://www.opengis.net/def/rel/ogc/1.0/conformance"],
  processes: ["processes", "http://www.opengis.net/def/rel/ogc/1.0/processes"],
  // Paging. IANA-registered short names only: neither reference server writes
  // an OGC URI form for these, and ZOO advertises both on a limited page
  // (`?limit=20` → `next` with `skip=20`; `prev` from the second page on).
  next: ["next"],
  prev: ["prev", "previous"],
  // Execution. Both reference servers advertise this on the process
  // description, and both write only the long OGC URI form — never the short
  // `execute` — which is the mirror image of how they spell `conformance`.
  // Verified 2026-09-01 against pygeoapi 0.21.0 and ZOO fork 46289f6.
  execute: ["execute", "http://www.opengis.net/def/rel/ogc/1.0/execute"],
  // Where a created job reports its status. ZOO writes `rel="monitor"` in the
  // body of its async 201, and that link is the *only* route to the job from a
  // cross-origin browser, where `Location` is filtered out — see T7 and
  // finding 0002. `status` is included because OGC registers it for the same
  // resource and a server may reasonably pick it.
  monitor: ["monitor", "status", "http://www.opengis.net/def/rel/ogc/1.0/monitor"],
};

/**
 * RFC 8288 registered relation names are case-insensitive, and the OGC URIs are
 * compared case-insensitively too — a server that title-cases a rel is unusual
 * but not wrong enough to justify failing to find its processes endpoint.
 */
export function aliasesFor(relation: KnownRelation): readonly string[] {
  return REL_ALIASES[relation];
}

/**
 * Normalise one relation token for comparison.
 *
 * `https://` folds to `http://` because the OGC relation URIs are identifiers,
 * not addresses we fetch — a server writing the https form means the same
 * relation. `conformance/parse.ts` already treats conformance-class URIs that
 * way, and the two should not disagree.
 */
function normalise(token: string): string {
  const lowered = token.trim().toLowerCase();
  return lowered.startsWith("https://") ? `http://${lowered.slice("https://".length)}` : lowered;
}

/**
 * RFC 8288 §3.3: `rel` is a *space-separated list* of relation types, so
 * `rel="conformance alternate"` carries both. Comparing the whole attribute
 * finds neither, and a server that annotates its conformance link as also
 * being an alternate representation would look like it had no conformance
 * link at all.
 */
export function matchesRelation(rel: string, relation: KnownRelation): boolean {
  const aliases = aliasesFor(relation);
  return rel
    .trim()
    .split(/\s+/)
    .some((token) => token !== "" && aliases.some((alias) => alias === normalise(token)));
}
