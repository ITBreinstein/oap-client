import { type FetchLike, resolveFetch } from "./http/fetch.js";

export interface ClientOptions {
  /** Landing page of the OGC API - Processes service. */
  readonly baseUrl: string | URL;
  /** Defaults to the ambient `fetch`. */
  readonly fetch?: FetchLike | undefined;
}

export interface Client {
  readonly baseUrl: URL;
  /** Resolves `path` against the base URL and performs the request. */
  request(path: string, init?: RequestInit): Promise<Response>;
}

export function createClient(options: ClientOptions): Client {
  // A trailing slash matters: without it, `new URL("processes", base)` drops the
  // last path segment of the base.
  const baseHref = options.baseUrl.toString();
  const baseUrl = new URL(baseHref.endsWith("/") ? baseHref : `${baseHref}/`);
  const doFetch = resolveFetch(options.fetch);

  return {
    baseUrl,
    request(path: string, init?: RequestInit): Promise<Response> {
      return doFetch(new URL(path, baseUrl).toString(), init);
    },
  };
}
