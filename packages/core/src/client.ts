import { send, type SendOptions } from "./http/transport.js";
import type { ResponseEnvelope } from "./http/envelope.js";
import { type FetchLike, resolveFetch } from "./http/fetch.js";
import { inspect, type InspectOptions, type ServiceDescription } from "./discovery/inspect.js";

export interface ClientOptions {
  /** Landing page of the OGC API - Processes service. */
  readonly baseUrl: string | URL;
  /** Defaults to the ambient `fetch`. */
  readonly fetch?: FetchLike | undefined;
  /** Content-Length above which response bodies are not buffered. */
  readonly maxBufferBytes?: number | undefined;
}

/** Per-request options; `fetch` is fixed at construction and cannot be overridden here. */
export type RequestOptions = Omit<SendOptions, "fetch">;

/** Per-call discovery options; transport concerns come from the client. */
export type InspectRequestOptions = Omit<InspectOptions, "fetch" | "maxBufferBytes">;

export interface Client {
  readonly baseUrl: URL;
  /**
   * Resolves `path` against the base URL and performs the request.
   *
   * Returns an envelope for *any* completed response, including 4xx and 5xx —
   * only a request that never produced one throws. Pass the result through
   * `requireOk` to turn a server's refusal into a `ProcessesError`.
   */
  send(path: string, options?: RequestOptions): Promise<ResponseEnvelope>;
  /**
   * Fetch the landing page and conformance document, and describe the service.
   *
   * Everything downstream of this should navigate by the returned `links`
   * rather than by building paths from `baseUrl` — that is the whole point of
   * the call. Pass a `signal` to cancel it.
   */
  inspect(options?: InspectRequestOptions): Promise<ServiceDescription>;
}

export function createClient(options: ClientOptions): Client {
  // A trailing slash matters: without it, `new URL("processes", base)` drops the
  // last path segment of the base.
  const baseHref = options.baseUrl.toString();
  const baseUrl = new URL(baseHref.endsWith("/") ? baseHref : `${baseHref}/`);
  // Resolved once, here, so a runtime with no fetch fails at construction
  // rather than on the first request.
  const doFetch = resolveFetch(options.fetch);

  return {
    baseUrl,
    send(path: string, requestOptions: RequestOptions = {}): Promise<ResponseEnvelope> {
      return send(new URL(path, baseUrl), {
        ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
        ...requestOptions,
        fetch: doFetch,
      });
    },
    inspect(inspectOptions: InspectRequestOptions = {}): Promise<ServiceDescription> {
      return inspect(baseUrl, {
        ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
        ...inspectOptions,
        fetch: doFetch,
      });
    },
  };
}
