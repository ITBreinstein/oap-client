import { send, type SendOptions } from "./http/transport.js";
import type { ResponseEnvelope } from "./http/envelope.js";
import { type FetchLike, resolveFetch } from "./http/fetch.js";
import { inspect, type InspectOptions, type ServiceDescription } from "./discovery/inspect.js";
import { AbortError } from "./http/errors.js";
import { findLink } from "./links/find.js";
import { observe, redactUrl, type ObservationSink } from "./observations.js";
import { listProcesses, type ListProcessesOptions } from "./processes/list-processes.js";
import { getProcess, type GetProcessOptions } from "./processes/get-process.js";
import type { ProcessDescription, ProcessList } from "./processes/types.js";

export interface ClientOptions {
  /** Landing page of the OGC API - Processes service. */
  readonly baseUrl: string | URL;
  /** Defaults to the ambient `fetch`. */
  readonly fetch?: FetchLike | undefined;
  /** Content-Length above which response bodies are not buffered. */
  readonly maxBufferBytes?: number | undefined;
  /**
   * Where this client's observations go. Set once here rather than per call, so
   * a caller cannot accidentally lose half the interoperability evidence by
   * forgetting it on one method. Overridable per call all the same.
   */
  readonly onObservation?: ObservationSink | undefined;
}

/** Per-request options; `fetch` is fixed at construction and cannot be overridden here. */
export type RequestOptions = Omit<SendOptions, "fetch">;

/** Per-call discovery options; transport concerns come from the client. */
export type InspectRequestOptions = Omit<InspectOptions, "fetch" | "maxBufferBytes">;

/** Per-call list options; transport concerns come from the client. */
export type ListRequestOptions = Omit<ListProcessesOptions, "fetch" | "maxBufferBytes">;

/** Per-call description options; transport concerns come from the client. */
export type GetProcessRequestOptions = Omit<GetProcessOptions, "fetch" | "maxBufferBytes">;

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
  /**
   * The service's processes, following `rel="next"` to a bounded depth.
   *
   * Does **not** require {@link Client.inspect} to have been called first: it
   * runs discovery itself when it has to, because the endpoint screen's first
   * action is to list processes and "it just works" is the ergonomics that
   * screen needs. The resolved list URL is remembered for the life of the
   * client so a second call does not re-discover.
   */
  listProcesses(options?: ListRequestOptions): Promise<ProcessList>;
  /**
   * One process description.
   *
   * Pass the list entry as `summary` when you have it — the UI almost always
   * does — and its `self` link is followed instead of a rebuilt path.
   */
  getProcess(processId: string, options?: GetProcessRequestOptions): Promise<ProcessDescription>;
}

/**
 * Resolve `./processes` against the landing-page URL.
 *
 * Only reached when the landing page advertises no `processes` link, or when
 * discovery itself failed. The trailing slash goes on the *path* and the query
 * is dropped, for the reasons spelled out in `discovery/inspect.ts` — a landing
 * page reached through the `?f=json` fallback ends in a query, and appending
 * there lands the guess at the origin root instead of under the path prefix.
 */
function processesFallback(landingUrl: string): string {
  const base = new URL(landingUrl);
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  base.search = "";
  base.hash = "";
  return new URL("processes", base).toString();
}

function isAbort(error: unknown): boolean {
  return error instanceof AbortError || (error instanceof Error && error.name === "AbortError");
}

export function createClient(options: ClientOptions): Client {
  // A trailing slash matters: without it, `new URL("processes", base)` drops the
  // last path segment of the base.
  const baseHref = options.baseUrl.toString();
  const baseUrl = new URL(baseHref.endsWith("/") ? baseHref : `${baseHref}/`);
  // Resolved once, here, so a runtime with no fetch fails at construction
  // rather than on the first request.
  const doFetch = resolveFetch(options.fetch);

  const transport = {
    ...(options.maxBufferBytes === undefined ? {} : { maxBufferBytes: options.maxBufferBytes }),
    fetch: doFetch,
  };

  /**
   * The resolved process-list URL, remembered per client.
   *
   * This is not a document cache — §2 rules those out and it would need
   * invalidation, per-service scoping and a test suite of its own. It is one
   * URL, for one base URL, that cannot change for the life of this object, and
   * remembering it is what stops every `listProcesses()` costing two extra
   * requests. The *promise* is memoised so two concurrent calls share one
   * discovery, and it is dropped again on rejection so a cancelled or failed
   * first call cannot poison the client.
   */
  let processesUrl: Promise<string> | undefined;

  function discoverProcessesUrl(
    sink: ObservationSink | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    if (processesUrl !== undefined) return processesUrl;

    const pending = (async (): Promise<string> => {
      const landing = baseUrl.toString();
      try {
        const service = await inspect(baseUrl, {
          ...transport,
          ...(signal === undefined ? {} : { signal }),
          ...(sink === undefined ? {} : { onObservation: sink }),
        });
        const advertised = findLink(service.links, "processes");
        if (advertised !== undefined) {
          observe(sink, {
            kind: "processes-link",
            source: "advertised",
            url: redactUrl(advertised.href),
          });
          return advertised.href;
        }
        const guessed = processesFallback(service.url);
        observe(sink, { kind: "processes-link", source: "path-fallback", url: redactUrl(guessed) });
        return guessed;
      } catch (error) {
        if (isAbort(error)) throw error;
        // A landing page we cannot read does not mean `/processes` is unreachable
        // — a service may serve HTML at its root and JSON below it. Degrade to
        // the guess and record it, rather than refusing to list at all.
        const guessed = processesFallback(landing);
        observe(sink, { kind: "processes-link", source: "path-fallback", url: redactUrl(guessed) });
        return guessed;
      }
    })();

    processesUrl = pending;
    pending.catch(() => {
      if (processesUrl === pending) processesUrl = undefined;
    });
    return pending;
  }

  return {
    baseUrl,
    send(path: string, requestOptions: RequestOptions = {}): Promise<ResponseEnvelope> {
      return send(new URL(path, baseUrl), { ...transport, ...requestOptions, fetch: doFetch });
    },
    inspect(inspectOptions: InspectRequestOptions = {}): Promise<ServiceDescription> {
      return inspect(baseUrl, {
        ...transport,
        ...(options.onObservation === undefined ? {} : { onObservation: options.onObservation }),
        ...inspectOptions,
      });
    },
    async listProcesses(listOptions: ListRequestOptions = {}): Promise<ProcessList> {
      const sink = listOptions.onObservation ?? options.onObservation;
      const url = await discoverProcessesUrl(sink, listOptions.signal);
      return listProcesses(url, {
        ...transport,
        ...listOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async getProcess(
      processId: string,
      getOptions: GetProcessRequestOptions = {},
    ): Promise<ProcessDescription> {
      const sink = getOptions.onObservation ?? options.onObservation;
      const url = await discoverProcessesUrl(sink, getOptions.signal);
      return getProcess(url, processId, {
        ...transport,
        ...getOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
  };
}
