/**
 * The browser's mixed-content rule, so the page can refuse a request before
 * sending it rather than watch it fail as an opaque network error — which,
 * cross-origin, looks exactly like a missing CORS header.
 *
 * A page served over HTTPS may not fetch from plain `http:`, except from an
 * address the browser treats as secure anyway: `localhost` and its
 * subdomains, 127.0.0.0/8, and `[::1]`.
 */

/** The addresses a browser treats as secure over plain HTTP. */
export function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::1]"
  );
}

/** True when a page on `pageProtocol` may not fetch `url` at all. */
export function isMixedContent(url: URL, pageProtocol: string | undefined): boolean {
  return pageProtocol === "https:" && url.protocol === "http:" && !isLoopback(url.hostname);
}

/** The page's own protocol; undefined off-browser. */
export function pageProtocol(): string | undefined {
  try {
    return globalThis.location.protocol;
  } catch {
    return undefined;
  }
}
