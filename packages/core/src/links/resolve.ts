/**
 * Merging the two places links come from, and resolving them against the right
 * base.
 *
 * The base is the highest-value correctness requirement in this layer. It is
 * always {@link ResponseEnvelope.url} — the URL the document was *served* from,
 * after redirects — and never the URL the caller typed. The user-supplied base
 * URL is deliberately not a parameter of anything in this file: what a function
 * cannot reach, it cannot use by mistake.
 *
 * Why it matters, in the shape it actually bites:
 *
 *   typed:    https://demo.example.nl/oapi      (no trailing slash)
 *   served:   https://demo.example.nl/oapi/     (server 301s to add one)
 *   link:     { "rel": "processes", "href": "processes" }
 *
 *   new URL("processes", "https://demo.example.nl/oapi")   // → /processes   404
 *   new URL("processes", "https://demo.example.nl/oapi/")  // → /oapi/processes
 *
 * That is RFC 3986 §5.2.3, not a quirk: without a trailing slash the last
 * segment is a file and gets replaced; with one it is a directory and the
 * relative reference is appended. A testbed service behind a gateway will hit
 * this, and it will hit it during a demo.
 */

import type { ResponseEnvelope } from "../http/envelope.js";
import { observe, redactUrl, type ObservationSink } from "../observations.js";
import type { Link } from "./types.js";

const EMPTY_LINKS: readonly Link[] = Object.freeze([]);

/**
 * Strict resolution: `undefined` when the href cannot be made absolute.
 *
 * `link-header.ts` has its own `resolve` that falls back to the raw value,
 * which is right for the envelope — a malformed header is evidence worth
 * keeping verbatim. It is wrong here, because a `Link` promises an absolute
 * `href` and handing back a relative one would push the failure into whoever
 * tries to fetch it.
 *
 * Exported for an href that is not in a `links` array: an output given by
 * reference in a results document is a link object whose only required
 * member is `href` (18-062r2 `link.yaml`), and ZOO-Project sends it with no
 * `rel` — which {@link resolveBodyLinks} rightly skips, since a link without a
 * relation cannot be looked up. `base` is the URL the carrying document was
 * served from, {@link ResponseEnvelope.url}, as everywhere in this file.
 */
export function resolveHref(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Present, a string, and not blank. Absent optional members stay absent. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Build a `Link` with `exactOptionalPropertyTypes` honoured: an absent member
 * must be genuinely absent, not present-and-undefined.
 */
function makeLink(
  href: string,
  rel: string,
  type: string | undefined,
  hreflang: string | undefined,
  title: string | undefined,
): Link {
  return {
    href,
    rel,
    ...(type === undefined ? {} : { type }),
    ...(hreflang === undefined ? {} : { hreflang }),
    ...(title === undefined ? {} : { title }),
  };
}

/** A link with a declared media type beats one without, all else being equal. */
function isBetter(candidate: Link, incumbent: Link): boolean {
  return incumbent.type === undefined && candidate.type !== undefined;
}

/**
 * A collector that dedupes as it goes, so header links and body links can be
 * added from either side without either caller owning the map.
 *
 * Duplicates — same rel, same resolved href — collapse, keeping the entry that
 * carries a media type.
 */
function createCollector(): {
  add: (link: Link) => void;
  take: () => readonly Link[];
} {
  const seen = new Map<string, Link>();
  return {
    add(link: Link): void {
      const key = `${link.rel.toLowerCase()} ${link.href}`;
      const incumbent = seen.get(key);
      if (incumbent === undefined || isBetter(link, incumbent)) {
        seen.set(key, link);
      }
    },
    take(): readonly Link[] {
      return seen.size === 0 ? EMPTY_LINKS : Object.freeze([...seen.values()]);
    },
  };
}

/**
 * Add the `links` member of a document — or of one *entry inside* a document —
 * to a collector, resolving every href against `base`.
 *
 * Split out from {@link collectLinks} for the process list, where each entry in
 * the `processes` array carries its own `links` that must resolve against the
 * URL the *list* was served from. Passing the list's envelope to
 * {@link collectLinks} once per entry would merge the list document's own
 * `Link:` response header into all 703 entries, which is a different and wrong
 * answer — every process would appear to advertise the list's `next` link.
 */
function addBodyLinks(
  add: (link: Link) => void,
  base: string,
  documentUrl: string,
  bodyLinks: readonly Link[] | undefined,
  sink: ObservationSink | undefined,
): void {
  // Widened back to `unknown` on purpose. The declared parameter type says what
  // a well-behaved caller passes; it is not evidence about what a server sent,
  // and validating against the declared type would check nothing.
  for (const entry of (bodyLinks ?? []) as readonly unknown[]) {
    if (!isRecord(entry)) {
      observe(sink, { kind: "link-skipped", documentUrl, reason: "not-an-object" });
      continue;
    }

    const rawHref = optionalString(entry["href"]);
    if (rawHref === undefined) {
      observe(sink, { kind: "link-skipped", documentUrl, reason: "missing-href" });
      continue;
    }

    const rel = optionalString(entry["rel"]);
    if (rel === undefined) {
      observe(sink, { kind: "link-skipped", documentUrl, reason: "missing-rel" });
      continue;
    }

    const href = resolveHref(rawHref, base);
    if (href === undefined) {
      observe(sink, { kind: "link-skipped", documentUrl, reason: "unresolvable-href" });
      continue;
    }

    add(
      makeLink(
        href,
        rel,
        optionalString(entry["type"]),
        optionalString(entry["hreflang"]),
        optionalString(entry["title"]),
      ),
    );
  }
}

/**
 * Resolve a bare `links` array against the URL its carrying document was served
 * from — no response header involved.
 *
 * For links nested *inside* a document: an entry of the `processes` array, and
 * later a job or a result. **Never throws**, for the same reason
 * {@link collectLinks} does not.
 */
export function resolveBodyLinks(
  baseUrl: string,
  bodyLinks: readonly Link[] | undefined,
  sink?: ObservationSink,
): readonly Link[] {
  const collector = createCollector();
  addBodyLinks(collector.add, baseUrl, redactUrl(baseUrl), bodyLinks, sink);
  return collector.take();
}

/**
 * Merge the links advertised in the `Link` response header with the links
 * carried in the document body, resolving every href against the URL the
 * document was actually served from.
 *
 * Duplicates (same rel + same resolved href) collapse, keeping the entry that
 * carries a media type.
 *
 * **Never throws.** A malformed link entry is skipped and recorded as an
 * observation. One bad link out of twelve must not take down discovery of the
 * other eleven — servers under test are exactly the servers that send bad
 * links, and refusing to proceed would turn a finding into an outage.
 */
export function collectLinks(
  envelope: ResponseEnvelope,
  bodyLinks: readonly Link[] | undefined,
  sink?: ObservationSink,
): readonly Link[] {
  const base = envelope.url;
  const documentUrl = redactUrl(base);
  const collector = createCollector();

  // Header links first: they are already parsed and resolved by the envelope.
  // A header link without a `rel` is unusable — there is nothing to look it up
  // by — but it is the server's malformed header, not a body link, so it is not
  // reported as a skipped body link.
  for (const header of envelope.links) {
    if (header.rel === undefined || header.rel.trim() === "") continue;
    const href = resolveHref(header.hrefRaw, base);
    if (href === undefined) {
      observe(sink, { kind: "link-skipped", documentUrl, reason: "unresolvable-href" });
      continue;
    }
    collector.add(makeLink(href, header.rel, header.type, header.hreflang, header.title));
  }

  addBodyLinks(collector.add, base, documentUrl, bodyLinks, sink);

  return collector.take();
}

/**
 * The `links` member of a document, as a shape `collectLinks` can consume.
 *
 * Returns `undefined` when there is no `links` member at all, and an empty
 * array when it is present but not an array — the difference matters to the
 * caller deciding whether the document is malformed.
 */
export function readBodyLinks(body: unknown): readonly Link[] | undefined {
  if (!isRecord(body)) return undefined;
  const links: unknown = body["links"];
  if (links === undefined) return undefined;
  // Not an array: the member exists but carries nothing followable. Treated as
  // "no links" rather than an error, because header links may still save us.
  if (!Array.isArray(links)) return EMPTY_LINKS;
  // Cast is safe because `collectLinks` validates every entry itself.
  return links as readonly Link[];
}
