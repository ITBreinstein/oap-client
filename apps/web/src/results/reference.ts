/**
 * Following an output given by reference, once the user asks (Task 8).
 *
 * The href is the server's choice and may be on anyone's host: fetching it
 * shows that host the user's address, and it may be large. So nothing here
 * runs until "Load" is clicked (T3), one click covers a collection's hop to
 * its items, and every way it can end is an outcome to show and record rather
 * than an exception.
 *
 * In order:
 *
 * 1. **Refused before sending** (T7): anything but `http:` and `https:`, and a
 *    plain `http:` href from a page served over HTTPS, which the browser would
 *    block as mixed content. Loopback addresses are exempt, as the browser
 *    exempts them.
 * 2. **Route** (T4): direct, unless this connection's reads already go
 *    through the relay — the user confirmed that — and the href is under the
 *    endpoint's `baseUrl`. The read route then carries it; it refuses anything
 *    outside the base by itself (`relay-fetch.ts`), and it is never widened
 *    (ADR 0001).
 * 3. **Read** through the core's `send`, `credentials: "omit"`, under the
 *    envelope's buffer limit, which since core 0.5.0 also stops a chunked
 *    body at the limit.
 * 4. **Classify by evidence** (T5), never by the label alone: parsed as JSON —
 *    `JSON.parse`, never evaluated — when the media type is JSON, JavaScript
 *    (ZOO serves GeoJSON as `application/javascript`, finding 0026), text or
 *    absent. Then GeoJSON by shape; else a collection, whose GeoJSON items
 *    link is followed once; else an image by media type; else "other".
 *
 * `Content-Crs` decides whether GeoJSON is plotted (T5): absent or CRS84 as
 * it is, EPSG:4326 with its axes swapped, anything else — EPSG:4258, RD New —
 * not at all. A swap is invisible to the coordinate-range check: a Dutch
 * point at (5, 52) swapped is (52, 5), still "in degrees", in Somalia
 * (finding 0051). Nothing reprojects.
 */

import {
  BODY_PREVIEW_LIMIT,
  BodyTooLargeError,
  collectLinks,
  findLink,
  findLinks,
  isJsonMediaType,
  readBodyLinks,
  send,
  TransportError,
  type FetchLike,
  type Link,
  type ResponseEnvelope,
} from "@breinstein/oap-client";
import { classifyCrs } from "../forms/crs.js";
import { shapesIn } from "../forms/geojson.js";
import { isJsonObject } from "../forms/json.js";
import { isUnder, relayRouteErrorIn } from "../relay/relay-fetch.js";

/** How a Load ended (T9). `failed`: no usable answer, and not a CORS-shaped one. */
export type ReferenceOutcome =
  | "ok"
  | "cors-blocked"
  | "http-error"
  | "too-large"
  | "unsupported-scheme"
  | "mixed-content"
  | "failed";

/** What the href turned out to hold (T5). */
export type Representation = "geojson" | "collection" | "image" | "other";

/** What `Content-Crs` means for the map (T5). */
export type AxisHandling = "as-is" | "swapped" | "not-plotted";

/** One page of features, and whether it is all of them (T6). */
export interface PageInfo {
  /** `numberReturned`, else the number of features. */
  readonly returned: number | undefined;
  readonly matched: number | undefined;
  readonly hasNext: boolean;
}

export interface LoadedReference {
  readonly outcome: ReferenceOutcome;
  /** Undefined when nothing was sent. */
  readonly route: "direct" | "relay" | undefined;
  readonly representation: Representation | undefined;
  /** The Content-Type of the href's own answer, verbatim. */
  readonly mediaType: string | undefined;
  /** For `http-error`. */
  readonly status: number | undefined;
  /** An error's body as text, cut short, or why nothing came back. Never markup to render. */
  readonly detail: string | undefined;
  /** The bytes read, for a download. Undefined when none were. */
  readonly blob: Blob | undefined;
  /** The GeoJSON to put on the map: the href's, or its collection's first page. */
  readonly geojson: unknown;
  /** `Content-Crs` without its angle brackets. */
  readonly contentCrs: string | undefined;
  readonly axes: AxisHandling | undefined;
  readonly page: PageInfo | undefined;
  /** The items link followed from a collection. */
  readonly itemsUrl: string | undefined;
}

export interface ReferenceEndpoint {
  readonly baseUrl: string;
  /** How this connection reads its server: `relay` only after the user confirmed it. */
  readonly reads: "direct" | "relay";
}

export interface LoadOptions {
  readonly endpoint: ReferenceEndpoint;
  /** The relay read route's fetch for this endpoint, when it has one. */
  readonly relayFetch?: FetchLike | undefined;
  /** Direct requests; the ambient `fetch` by default. */
  readonly fetch?: FetchLike | undefined;
  /** The page's own protocol, for the mixed-content check. */
  readonly pageProtocol?: string | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

const NOTHING: LoadedReference = {
  outcome: "failed",
  route: undefined,
  representation: undefined,
  mediaType: undefined,
  status: undefined,
  detail: undefined,
  blob: undefined,
  geojson: undefined,
  contentCrs: undefined,
  axes: undefined,
  page: undefined,
  itemsUrl: undefined,
};

function ended(
  fields: Partial<LoadedReference> & Pick<LoadedReference, "outcome">,
): LoadedReference {
  return { ...NOTHING, ...fields };
}

/** The addresses a browser treats as secure over plain HTTP. */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::1]"
  );
}

/** Why an href is not fetched at all, or undefined when it may be (T7). */
export function refusal(
  href: string,
  pageProtocol: string | undefined,
): "unsupported-scheme" | "mixed-content" | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "unsupported-scheme";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "unsupported-scheme";
  if (pageProtocol === "https:" && url.protocol === "http:" && !isLoopback(url.hostname)) {
    return "mixed-content";
  }
  return undefined;
}

/** True for an href a person may open: `http:` or `https:` only. */
export function isOpenable(href: string): boolean {
  try {
    const { protocol } = new URL(href);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** The origin of an http(s) href, and nothing else of it. */
export function originOf(href: string): string | undefined {
  return isOpenable(href) ? new URL(href).origin : undefined;
}

/** Task 8, T4: the relay only for this endpoint's own URLs, and only once confirmed. */
export function routeFor(
  href: string,
  endpoint: ReferenceEndpoint,
  relayFetch: FetchLike | undefined,
): "direct" | "relay" {
  return endpoint.reads === "relay" &&
    relayFetch !== undefined &&
    isUnder(new URL(href), endpoint.baseUrl)
    ? "relay"
    : "direct";
}

/** `<http://…/CRS84>` → `http://…/CRS84`. */
export function readContentCrs(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const bare = header.trim().replace(/^<\s*/, "").replace(/\s*>$/, "");
  return bare === "" ? undefined : bare;
}

export function axisHandling(contentCrs: string | undefined): AxisHandling {
  if (contentCrs === undefined) return "as-is";
  switch (classifyCrs(contentCrs)) {
    case "crs84":
      return "as-is";
    case "epsg4326":
      return "swapped";
    // CRS84h has a height the map drops, EPSG:4258 is latitude first too, and
    // anything else may be projected: none is what "as today" covers (T5).
    case "crs84h":
    case "other-epsg":
    case "unknown":
      return "not-plotted";
  }
}

/** Media types whose body may be JSON whatever the label says (T5, finding 0026). */
function mayBeJson(mediaType: string | undefined): boolean {
  return (
    mediaType === undefined ||
    isJsonMediaType(mediaType) ||
    mediaType === "application/javascript" ||
    mediaType === "text/javascript" ||
    mediaType === "text/plain"
  );
}

function pageOf(value: unknown, links: readonly Link[]): PageInfo {
  const body = isJsonObject(value) ? value : {};
  const returned = body["numberReturned"];
  const matched = body["numberMatched"];
  const features = body["features"];
  return {
    returned:
      typeof returned === "number"
        ? returned
        : Array.isArray(features)
          ? features.length
          : undefined,
    matched: typeof matched === "number" ? matched : undefined,
    hasNext: findLink(links, "next") !== undefined,
  };
}

/** Task 8, T6: a page that says it is not all of it. */
export function isTruncated(page: PageInfo | undefined): boolean {
  if (page === undefined) return false;
  return (
    page.hasNext ||
    (page.matched !== undefined && page.returned !== undefined && page.matched > page.returned)
  );
}

/** A collection's items link, asking for GeoJSON: typed GeoJSON first, then untyped, then JSON. */
function itemsLinkOf(links: readonly Link[]): Link | undefined {
  const items = findLinks(links, "items");
  return (
    items.find((link) => link.type === "application/geo+json") ??
    items.find((link) => link.type === undefined) ??
    items.find((link) => link.type === "application/json")
  );
}

function isGeoJson(value: unknown): boolean {
  const shapes = shapesIn(value);
  return shapes !== undefined && shapes.length > 0;
}

async function get(
  href: string,
  accept: string,
  route: "direct" | "relay",
  options: LoadOptions,
): Promise<ResponseEnvelope> {
  const fetch = route === "relay" ? options.relayFetch : options.fetch;
  return send(href, {
    method: "GET",
    headers: { Accept: accept },
    credentials: "omit",
    ...(fetch === undefined ? {} : { fetch }),
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

/** A request that produced no answer, as an outcome. */
function failure(cause: unknown, route: "direct" | "relay"): LoadedReference {
  const relay = relayRouteErrorIn(cause);
  if (relay !== undefined) return ended({ outcome: "failed", route, detail: relay.code });
  if (cause instanceof TransportError && cause.crossOrigin !== false) {
    return ended({ outcome: "cors-blocked", route });
  }
  return ended({
    outcome: "failed",
    route,
    detail: cause instanceof Error ? cause.name : String(cause),
  });
}

async function preview(envelope: ResponseEnvelope): Promise<string | undefined> {
  try {
    const text = (await envelope.text()).trim();
    return text === "" ? undefined : text.slice(0, BODY_PREVIEW_LIMIT);
  } catch {
    return undefined;
  }
}

/**
 * One fetched answer, classified. `hop` is false for a collection's items,
 * which are followed once and not again.
 */
async function classifyAnswer(
  envelope: ResponseEnvelope,
  route: "direct" | "relay",
  options: LoadOptions,
  hop: boolean,
): Promise<LoadedReference> {
  const mediaType = envelope.headers.get("content-type") ?? undefined;
  if (envelope.status < 200 || envelope.status > 299) {
    return ended({
      outcome: "http-error",
      route,
      mediaType,
      status: envelope.status,
      detail: await preview(envelope),
    });
  }
  // A declared length over the limit is not read at all: the href is the
  // server's choice, and the link is still there to open.
  if (envelope.bodyTooLarge) return ended({ outcome: "too-large", route, mediaType });

  if (envelope.mediaType?.startsWith("image/") === true) {
    const blob = await envelope.blob();
    return ended({ outcome: "ok", route, mediaType, representation: "image", blob });
  }
  if (!mayBeJson(envelope.mediaType)) {
    const blob = await envelope.blob();
    return ended({ outcome: "ok", route, mediaType, representation: "other", blob });
  }

  const text = await envelope.text();
  const blob = new Blob([text], { type: envelope.mediaType ?? "application/octet-stream" });
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return ended({ outcome: "ok", route, mediaType, representation: "other", blob });
  }

  const links = collectLinks(envelope, readBodyLinks(value));
  if (isGeoJson(value)) {
    const contentCrs = readContentCrs(envelope.contentCrs);
    return ended({
      outcome: "ok",
      route,
      mediaType,
      representation: "geojson",
      blob,
      geojson: value,
      contentCrs,
      axes: axisHandling(contentCrs),
      page: pageOf(value, links),
    });
  }

  const items = hop ? itemsLinkOf(links) : undefined;
  if (items === undefined) {
    return ended({ outcome: "ok", route, mediaType, representation: "other", blob });
  }
  // One click covers the hop (T3). Its outcome is the Load's outcome; the
  // representation stays "collection", whatever the items turn out to be.
  const followed = await follow(items.href, "application/geo+json", options, false);
  return {
    ...followed,
    representation: "collection",
    itemsUrl: items.href,
    geojson: followed.representation === "geojson" ? followed.geojson : undefined,
  };
}

async function follow(
  href: string,
  accept: string,
  options: LoadOptions,
  hop: boolean,
): Promise<LoadedReference> {
  const refused = refusal(href, options.pageProtocol);
  const route =
    refused === "unsupported-scheme"
      ? "direct"
      : routeFor(href, options.endpoint, options.relayFetch);
  // Through the relay the browser fetches the relay, not the href, so the
  // mixed-content check is the relay's URL's, not this one's.
  if (refused === "unsupported-scheme" || (refused === "mixed-content" && route === "direct")) {
    return ended({ outcome: refused, route: undefined });
  }
  let envelope: ResponseEnvelope;
  try {
    envelope = await get(href, accept, route, options);
  } catch (cause) {
    return failure(cause, route);
  }
  try {
    return await classifyAnswer(envelope, route, options, hop);
  } catch (cause) {
    if (cause instanceof BodyTooLargeError) {
      return ended({
        outcome: "too-large",
        route,
        mediaType: envelope.headers.get("content-type") ?? undefined,
      });
    }
    return failure(cause, route);
  }
}

/** Load what one output given by reference points at. Never throws. */
export async function loadReference(
  reference: { readonly href: string; readonly mediaType?: string | undefined },
  options: LoadOptions,
): Promise<LoadedReference> {
  const accept = reference.mediaType === undefined ? "*/*" : `${reference.mediaType}, */*;q=0.1`;
  return follow(reference.href, accept, options, true);
}
