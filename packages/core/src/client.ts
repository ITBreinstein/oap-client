import { send, type SendOptions } from "./http/transport.js";
import type { ResponseEnvelope } from "./http/envelope.js";
import { type FetchLike, resolveFetch } from "./http/fetch.js";
import { inspect, type InspectOptions, type ServiceDescription } from "./discovery/inspect.js";
import { AbortError, ProcessesError, TransportError } from "./http/errors.js";
import { findLink } from "./links/find.js";
import { observe, redactUrl, type ObservationSink } from "./observations.js";
import { listProcesses, type ListProcessesOptions } from "./processes/list-processes.js";
import { getProcess, type GetProcessOptions } from "./processes/get-process.js";
import { execute, type ExecuteOptions } from "./execution/index.js";
import type { Execution } from "./execution/index.js";
import {
  dismissJob,
  getJob,
  getResults,
  isAbsoluteUrl,
  jobUrlFor,
  jobsFallback,
  listJobs,
  pollJob,
  waitForJob,
  type Dismissal,
  type DismissJobOptions,
  type GetResultsOptions,
  type JobList,
  type JobRequestOptions,
  type JobResults,
  type JobStatus,
  type ListJobsOptions,
  type PollJobOptions,
  type PollReport,
} from "./jobs/index.js";
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

/** Per-call execution options; transport concerns come from the client. */
export type ExecuteRequestOptions = Omit<ExecuteOptions, "fetch" | "maxBufferBytes">;

/** Per-call job options; transport concerns come from the client. */
export type JobRequestOptionsFor<T> = Omit<T, "fetch" | "maxBufferBytes">;

/** Per-call status-read options. */
export type GetJobRequestOptions = JobRequestOptionsFor<JobRequestOptions>;
/** Per-call poll options. */
export type PollJobRequestOptions = JobRequestOptionsFor<PollJobOptions>;
/** Per-call results options. */
export type GetResultsRequestOptions = JobRequestOptionsFor<GetResultsOptions>;
/** Per-call dismiss options. */
export type DismissJobRequestOptions = JobRequestOptionsFor<DismissJobOptions>;
/** Per-call job-list options. */
export type ListJobsRequestOptions = JobRequestOptionsFor<ListJobsOptions>;

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
  /**
   * Run a process, and hand back what the server actually did.
   *
   * The returned {@link Execution} is a discriminated union: branch on `kind`.
   * `"immediate"` carries the {@link ResponseEnvelope} **unparsed**, because
   * the correct parse depends on a media type the core has no opinion about —
   * a synchronous execution may answer with GeoJSON, a PNG, a zip or GML.
   * `"job"` carries a {@link JobHandle} with the status URL and how it was
   * found.
   *
   * Which arm you get is decided by the response's own evidence, never by
   * `options.mode`: a server may return a job for a request that did not ask
   * for one, and may run something synchronously despite `Prefer:
   * respond-async`. `requestedMode` survives on both arms so the disagreement
   * can be recorded rather than smoothed over.
   *
   * Pass `description` — the UI almost always has it — and its `execute` link
   * is used instead of a rebuilt path, and its inputs are checked for arity
   * mismatches. Those checks **warn and send anyway**; the core does not refuse
   * a request because it disagrees with a description.
   */
  execute(processId: string, options?: ExecuteRequestOptions): Promise<Execution>;
  /**
   * Read one job's status.
   *
   * Takes either an absolute status URL — the `statusUrl` off a
   * {@link JobHandle} — or a bare job id, which is all a browser has when it
   * recovered the job from the job list because it could not read `Location`.
   *
   * A **failed job is not an error**: it resolves with a {@link JobStatus}
   * whose `status` is `"failed"`, carrying the server's own explanation. A 404
   * raises {@link JobNotFoundError}, which on both reference servers is the
   * normal state of a job that has been dismissed.
   */
  getJob(jobUrlOrId: string, options?: GetJobRequestOptions): Promise<JobStatus>;
  /**
   * Poll a job to a terminal status, reporting progress as it goes.
   *
   * Pass `onStatus` to drive a progress display — it is called once per poll,
   * in order, and a callback that throws cannot break the loop. Pass `signal`
   * to cancel: the signal is checked *between* polls, so a cancelled loop
   * provably makes no further request.
   *
   * Resolves for a failed or dismissed job as readily as for a successful one.
   * Rejects with {@link JobPollTimeoutError} if the total deadline expires,
   * which is deliberately a different error from the caller's abort.
   */
  pollJob(jobUrlOrId: string, options?: PollJobRequestOptions): Promise<PollReport>;
  /** {@link Client.pollJob}, resolving with the final status rather than the report. */
  waitForJob(jobUrlOrId: string, options?: PollJobRequestOptions): Promise<JobStatus>;
  /**
   * Fetch a finished job's results, **unparsed**.
   *
   * Returns the {@link ResponseEnvelope} for the same reason `execute()` does:
   * a result may be GeoJSON, a PNG, a zip or GML, and the correct parse depends
   * on a media type the core has no opinion about. Pass the `status` you
   * already hold and its advertised `results` link is used instead of a rebuilt
   * path.
   */
  getResults(jobUrlOrId: string, options?: GetResultsRequestOptions): Promise<JobResults>;
  /**
   * Ask the service to dismiss a job.
   *
   * Returns a {@link Dismissal} rather than `void`, and a 405 or 501 is
   * `kind: "unsupported"` rather than an exception — a server saying it cannot
   * dismiss is the answer the request asked for, not a failure. Anything else
   * non-ok still throws.
   *
   * **Never gated on `capabilities.dismiss`.** pygeoapi honours `DELETE` while
   * declaring no dismiss class, and a client that checked first would never
   * have found out.
   */
  dismissJob(jobUrlOrId: string, options?: DismissJobRequestOptions): Promise<Dismissal>;
  /**
   * The service's jobs, following `rel="next"` to a bounded depth.
   *
   * Prefers the `job-list` link the landing page advertises, falling back to a
   * constructed `./jobs`, and remembers which for the life of the client.
   */
  listJobs(options?: ListJobsRequestOptions): Promise<JobList>;
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

/**
 * Discovery failed without the server having said anything: no response at
 * all, or a 5xx. Worth asking again next time, unlike an answer that was
 * simply not a usable landing page, which will be the same answer tomorrow.
 */
/** A discovered URL, and whether it is a guess made because the landing page could not be reached. */
interface Discovered {
  readonly url: string;
  readonly transient: boolean;
}

function isTransient(error: unknown): boolean {
  return (
    error instanceof TransportError || (error instanceof ProcessesError && error.status >= 500)
  );
}

/**
 * `start()`'s promise, or an {@link AbortError} as soon as `signal` aborts —
 * whichever comes first. The shared work behind the promise carries on for
 * any other caller waiting on it; only this caller stops waiting.
 */
function untilAborted<T>(
  start: () => Promise<T>,
  signal: AbortSignal | undefined,
  url: URL,
): Promise<T> {
  if (signal === undefined) return start();
  if (signal.aborted) return Promise.reject(new AbortError(url.toString()));
  const promise = start();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new AbortError(url.toString()));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
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
   * discovery.
   *
   * The shared discovery takes no caller's signal: one caller cancelling must
   * not fail another that shares it. Each caller honours its own signal at the
   * call site, through {@link untilAborted}. And a guess made because the
   * landing page could not be *reached* is not remembered — see
   * {@link isTransient} — so a network blip does not pin the client to the
   * guess over a link the server does advertise.
   */
  let processesUrl: Promise<string> | undefined;

  function discoverProcessesUrl(sink: ObservationSink | undefined): Promise<string> {
    if (processesUrl !== undefined) return processesUrl;

    const discovery = (async (): Promise<Discovered> => {
      const landing = baseUrl.toString();
      try {
        const service = await inspect(baseUrl, {
          ...transport,
          ...(sink === undefined ? {} : { onObservation: sink }),
        });
        const advertised = findLink(service.links, "processes");
        if (advertised !== undefined) {
          observe(sink, {
            kind: "processes-link",
            source: "advertised",
            url: redactUrl(advertised.href),
          });
          return { url: advertised.href, transient: false };
        }
        const guessed = processesFallback(service.url);
        observe(sink, { kind: "processes-link", source: "path-fallback", url: redactUrl(guessed) });
        return { url: guessed, transient: false };
      } catch (error) {
        // A landing page we cannot read does not mean `/processes` is unreachable
        // — a service may serve HTML at its root and JSON below it. Degrade to
        // the guess and record it, rather than refusing to list at all.
        const guessed = processesFallback(landing);
        observe(sink, { kind: "processes-link", source: "path-fallback", url: redactUrl(guessed) });
        return { url: guessed, transient: isTransient(error) };
      }
    })();

    const pending = discovery.then(({ url }) => url);
    processesUrl = pending;
    const forget = (): void => {
      if (processesUrl === pending) processesUrl = undefined;
    };
    discovery.then(({ transient }) => {
      if (transient) forget();
    }, forget);
    return pending;
  }

  /**
   * The resolved job-list URL, remembered per client, on the same terms as
   * {@link discoverProcessesUrl}.
   */
  let jobsUrl: Promise<string> | undefined;

  function discoverJobsUrl(sink: ObservationSink | undefined): Promise<string> {
    if (jobsUrl !== undefined) return jobsUrl;

    const discovery = (async (): Promise<Discovered> => {
      const landing = baseUrl.toString();
      try {
        const service = await inspect(baseUrl, {
          ...transport,
          ...(sink === undefined ? {} : { onObservation: sink }),
        });
        const advertised = findLink(service.links, "jobList");
        if (advertised !== undefined) {
          observe(sink, {
            kind: "job-list-link",
            source: "advertised",
            url: redactUrl(advertised.href),
          });
          return { url: advertised.href, transient: false };
        }
        // Both reference servers advertise the link, so reaching this is itself
        // worth recording — see finding 0006 for the server that advertises the
        // link while declaring no matching conformance class.
        const guessed = jobsFallback(service.url);
        observe(sink, { kind: "job-list-link", source: "path-fallback", url: redactUrl(guessed) });
        return { url: guessed, transient: false };
      } catch (error) {
        const guessed = jobsFallback(landing);
        observe(sink, { kind: "job-list-link", source: "path-fallback", url: redactUrl(guessed) });
        return { url: guessed, transient: isTransient(error) };
      }
    })();

    const pending = discovery.then(({ url }) => url);
    jobsUrl = pending;
    const forget = (): void => {
      if (jobsUrl === pending) jobsUrl = undefined;
    };
    discovery.then(({ transient }) => {
      if (transient) forget();
    }, forget);
    return pending;
  }

  /**
   * An absolute status URL, whatever the caller had.
   *
   * A `JobHandle` carries the absolute URL the server itself gave out, and that
   * is always preferred. A bare id has to be turned into a URL somewhere, and
   * doing it once here beats doing it at every call site — which is half the
   * reason these are client methods at all.
   */
  async function resolveJobUrl(
    jobUrlOrId: string,
    sink: ObservationSink | undefined,
  ): Promise<string> {
    if (isAbsoluteUrl(jobUrlOrId)) return jobUrlOrId;
    return jobUrlFor(await discoverJobsUrl(sink), jobUrlOrId);
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
      const url = await untilAborted(() => discoverProcessesUrl(sink), listOptions.signal, baseUrl);
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
      const url = await untilAborted(() => discoverProcessesUrl(sink), getOptions.signal, baseUrl);
      return getProcess(url, processId, {
        ...transport,
        ...getOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async execute(
      processId: string,
      executeOptions: ExecuteRequestOptions = {},
    ): Promise<Execution> {
      const sink = executeOptions.onObservation ?? options.onObservation;
      // Only needed for the constructed-path fallback; a description carrying
      // an `execute` link makes this discovery free on the second call and
      // irrelevant on the first.
      const url = await untilAborted(
        () => discoverProcessesUrl(sink),
        executeOptions.signal,
        baseUrl,
      );
      return execute(url, processId, {
        ...transport,
        ...executeOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async getJob(jobUrlOrId: string, jobOptions: GetJobRequestOptions = {}): Promise<JobStatus> {
      const sink = jobOptions.onObservation ?? options.onObservation;
      const url = await resolveJobUrl(jobUrlOrId, sink);
      return getJob(url, {
        ...transport,
        ...jobOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async pollJob(
      jobUrlOrId: string,
      pollOptions: PollJobRequestOptions = {},
    ): Promise<PollReport> {
      const sink = pollOptions.onObservation ?? options.onObservation;
      const url = await resolveJobUrl(jobUrlOrId, sink);
      return pollJob(url, {
        ...transport,
        ...pollOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async waitForJob(
      jobUrlOrId: string,
      pollOptions: PollJobRequestOptions = {},
    ): Promise<JobStatus> {
      const sink = pollOptions.onObservation ?? options.onObservation;
      const url = await resolveJobUrl(jobUrlOrId, sink);
      return waitForJob(url, {
        ...transport,
        ...pollOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async getResults(
      jobUrlOrId: string,
      resultsOptions: GetResultsRequestOptions = {},
    ): Promise<JobResults> {
      const sink = resultsOptions.onObservation ?? options.onObservation;
      const url = await resolveJobUrl(jobUrlOrId, sink);
      return getResults(url, {
        ...transport,
        ...resultsOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async dismissJob(
      jobUrlOrId: string,
      dismissOptions: DismissJobRequestOptions = {},
    ): Promise<Dismissal> {
      const sink = dismissOptions.onObservation ?? options.onObservation;
      const url = await resolveJobUrl(jobUrlOrId, sink);
      return dismissJob(url, {
        ...transport,
        ...dismissOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
    async listJobs(listOptions: ListJobsRequestOptions = {}): Promise<JobList> {
      const sink = listOptions.onObservation ?? options.onObservation;
      const url = await discoverJobsUrl(sink);
      return listJobs(url, {
        ...transport,
        ...listOptions,
        ...(sink === undefined ? {} : { onObservation: sink }),
      });
    },
  };
}
