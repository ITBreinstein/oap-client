/**
 * The page's place in its own address: `?service=…` once connected,
 * `&process=…` once a process is open, and `&job=…` while a background job
 * runs and once its results are on screen. So a reload comes back to the
 * same place, Back and Forward move between the places visited, and a place
 * can be passed on as a link: a job's link shows its status, then its
 * results, wherever it is opened. Every other parameter (`style`, `theme`,
 * `developer`) is left as it is.
 *
 * A link that names a service never connects by itself: the start screen
 * fills in the address and the user presses Connect, so a link alone never
 * has this browser reach a server its user did not choose. Reload, Back and
 * Forward do go straight back, because the page wrote the way it connected
 * (relay or direct, which entry) into its own history entry
 * (`history.state`), which only it can have put there.
 *
 * Leaving the page is questioned while a run is under way or the form holds
 * something typed: the browser asks before throwing it away.
 *
 * A job removed from My jobs is not named again: "Remove from list" takes it
 * out of the address at once, in place, and the address leaves it out from
 * then on, even while its results stay on screen. Otherwise a reload would
 * follow the job from the address and list it again. A reload still on its way
 * back to the job when it is removed does not follow it either.
 */

import { useEffect, useRef, useState } from "react";
import { typedEndpoint } from "./run.js";
import type { WorkflowCommands } from "./useWorkflow.js";
import type { EndpointRef, Workflow } from "./workflow.js";

/** Where the page is: a service, a process there, and a job of it. */
export interface Place {
  readonly service?: string | undefined;
  readonly process?: string | undefined;
  /** The job's id: its status is at `{service}/jobs/{job}`, as the standard has it. */
  readonly job?: string | undefined;
}

/** What the page keeps in its history entries: how it reached the service. */
interface Saved {
  readonly oapEndpoint?: EndpointRef | undefined;
}

/** An address without the slashes at its end, so `…/ogcapi/` and `…/ogcapi` are one. */
function plain(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Whether two service addresses are the same service. */
export function sameService(a: string, b: string): boolean {
  return plain(a) === plain(b);
}

export function samePlace(a: Place, b: Place): boolean {
  return (
    (a.service === undefined ? undefined : plain(a.service)) ===
      (b.service === undefined ? undefined : plain(b.service)) &&
    a.process === b.process &&
    a.job === b.job
  );
}

/** Where the standard puts the status of job `id` of `service`. */
export function jobUrl(service: string, id: string): string {
  return `${plain(service)}/jobs/${encodeURIComponent(id)}`;
}

/**
 * The id of the job whose status is at `statusUrl`, when that is where the
 * standard puts it on `service`; otherwise undefined, and the job has no
 * link: an id alone could not find it again.
 */
export function jobIdIn(service: string, statusUrl: string): string | undefined {
  const prefix = `${plain(service)}/jobs/`;
  if (!statusUrl.startsWith(prefix)) return undefined;
  const rest = statusUrl.slice(prefix.length);
  if (rest === "" || /[/?#]/.test(rest)) return undefined;
  try {
    const id = decodeURIComponent(rest);
    return jobUrl(service, id) === statusUrl ? id : undefined;
  } catch {
    return undefined;
  }
}

/** The job a workflow state shows, when it has a link. */
function jobOf(state: Workflow): string | undefined {
  if (state.stage !== "running" && state.stage !== "result") return undefined;
  const statusUrl =
    state.stage === "running" && state.run.mode === "async"
      ? state.run.jobRef
      : state.stage === "result"
        ? state.jobRef
        : undefined;
  return statusUrl === undefined ? undefined : jobIdIn(state.endpoint.baseUrl, statusUrl);
}

/** The place a workflow state is at. */
export function placeOf(state: Workflow): Place {
  switch (state.stage) {
    case "choose-endpoint":
      return {};
    case "connected":
      return { service: state.endpoint.baseUrl };
    case "process":
      return { service: state.endpoint.baseUrl, process: state.process.id };
    case "running":
    case "result": {
      const job = jobOf(state);
      return job === undefined
        ? { service: state.endpoint.baseUrl, process: state.process.id }
        : { service: state.endpoint.baseUrl, process: state.process.id, job };
    }
  }
}

/**
 * Whether a state is on its way somewhere: connecting, waiting for the
 * answer to the relay question, or reading a description. The address
 * changes once it has arrived.
 */
export function inTransit(state: Workflow): boolean {
  if (state.stage === "choose-endpoint") {
    return state.connecting !== undefined || state.offer !== undefined;
  }
  return state.stage === "connected" && state.opening !== undefined;
}

/**
 * The place an address names. A `service` that is not an http(s) address is
 * ignored, a `process` without a service means nothing, and a `job` without
 * a process neither.
 */
export function placeInSearch(search: string): Place {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }
  const service = typedEndpoint(params.get("service") ?? "")?.baseUrl;
  if (service === undefined) return {};
  const process = params.get("process")?.trim();
  if (process === undefined || process === "") return { service };
  const job = params.get("job")?.trim();
  return job === undefined || job === "" ? { service, process } : { service, process, job };
}

/** `search` with the place in it, every other parameter kept, in its order. */
export function withPlace(search: string, place: Place): string {
  const params = new URLSearchParams(search);
  params.delete("service");
  params.delete("process");
  params.delete("job");
  if (place.service !== undefined) params.set("service", place.service);
  if (place.process !== undefined) params.set("process", place.process);
  if (place.job !== undefined) params.set("job", place.job);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * The query of a link to `place` for someone else (#34): the place, and what
 * else the page was opened with, but not this visitor's own display settings.
 * The receiver's page keeps its own style and theme.
 */
export function sharedSearch(search: string, place: Place): string {
  const params = new URLSearchParams(search);
  params.delete("style");
  params.delete("theme");
  return withPlace(params.toString(), place);
}

/** The whole address of `place` on this page, to pass on as a link. */
export function linkTo(place: Place): string {
  const { origin, pathname, search } = globalThis.location;
  return `${origin}${pathname}${sharedSearch(search, place)}`;
}

/**
 * Whether leaving now would lose something: a run under way, or what was
 * typed. Not a background job with a link: it goes on, in My jobs, and the
 * address comes back to it.
 */
export function wouldLoseWork(state: Workflow): boolean {
  if (state.stage === "running") return jobOf(state) === undefined;
  if (state.stage !== "process") return false;
  return Object.values(state.values).some(
    (value) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0),
  );
}

function savedEndpoint(historyState: unknown): EndpointRef | undefined {
  if (typeof historyState !== "object" || historyState === null) return undefined;
  const endpoint: unknown = (historyState as Saved).oapEndpoint;
  if (typeof endpoint !== "object" || endpoint === null) return undefined;
  const baseUrl: unknown = Reflect.get(endpoint, "baseUrl");
  return typeof baseUrl === "string" ? (endpoint as EndpointRef) : undefined;
}

function endpointOf(state: Workflow): EndpointRef | undefined {
  return state.stage === "choose-endpoint" ? undefined : state.endpoint;
}

/** A job to follow once its process is open: the one a link or My jobs names. */
interface Following {
  readonly service: string;
  readonly process: string;
  readonly statusUrl: string;
}

/** Go to `place`, by the way the page saved for it, from wherever the state is. */
function go(
  place: Place,
  saved: EndpointRef | undefined,
  state: Workflow,
  commands: WorkflowCommands,
  follow: (job: Following) => void,
): "went" | "not-saved" {
  const here = endpointOf(state);
  if (place.service === undefined) {
    if (state.stage !== "choose-endpoint") commands.disconnect();
    return "went";
  }
  const endpoint =
    here !== undefined && plain(here.baseUrl) === plain(place.service)
      ? here
      : saved !== undefined && plain(saved.baseUrl) === plain(place.service)
        ? saved
        : undefined;
  if (endpoint === undefined) return "not-saved";
  if (place.process !== undefined) {
    if (place.job !== undefined) {
      follow({
        service: endpoint.baseUrl,
        process: place.process,
        statusUrl: jobUrl(endpoint.baseUrl, place.job),
      });
    }
    commands.openExample(endpoint, place.process);
  } else if (endpoint === here) {
    if (state.stage === "process" || state.stage === "result") commands.backToList();
  } else {
    commands.connect(endpoint);
  }
  return "went";
}

export interface AddressView {
  /** A place named by a link this page was opened with, waiting for Connect. */
  readonly linked: Place | undefined;
  /** Connect, and open the linked process (and job) when it is the linked service. */
  readonly connect: (endpoint: EndpointRef) => void;
  /** Open `processId` on `endpoint`, then follow the job at `statusUrl` there. */
  readonly followJob: (endpoint: EndpointRef, processId: string, statusUrl: string) => void;
  /** "Remove from list": forget the job, and take it out of the address. */
  readonly removeJob: (statusUrl: string) => void;
}

/** `place` without its job when that job was removed from My jobs. */
function withoutRemoved(place: Place, removed: ReadonlySet<string>): Place {
  if (place.service === undefined || place.job === undefined) return place;
  return removed.has(jobUrl(place.service, place.job))
    ? { service: place.service, process: place.process }
    : place;
}

export function useAddress(state: Workflow, commands: WorkflowCommands): AddressView {
  // A link's place, unless this entry is one the page wrote itself (a reload).
  const [linked, setLinked] = useState<Place | undefined>(() => {
    const place = placeInSearch(globalThis.location.search);
    if (place.service === undefined) return undefined;
    const saved = savedEndpoint(globalThis.history.state);
    return saved !== undefined && plain(saved.baseUrl) === plain(place.service) ? undefined : place;
  });

  // The latest state and commands, for the listeners below.
  const latest = useRef({ state, commands });
  useEffect(() => {
    latest.current = { state, commands };
  });

  // Jobs removed from My jobs this visit, by status URL: never named again.
  const removed = useRef(new Set<string>());

  // A job to follow once its process is open, and whether that was just
  // asked for: the address waits for the job rather than name the form.
  const following = useRef<Following | undefined>(undefined);
  const watching = useRef(false);
  const follow = (job: Following) => {
    following.current = job;
  };
  useEffect(() => {
    const want = following.current;
    if (want === undefined) return;
    if (state.stage === "process") {
      following.current = undefined;
      if (sameService(state.endpoint.baseUrl, want.service) && state.process.id === want.process) {
        watching.current = true;
        commands.watchJob(want.statusUrl);
      }
    } else if (!inTransit(state)) {
      // Connecting or opening the process failed: there is no job to follow.
      following.current = undefined;
    }
  }, [state, commands]);

  // On arrival: back to where a reload left off, by the way it was reached.
  // Until the state gets moving, the address keeps the place it names.
  const arrived = useRef(false);
  const resuming = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    const place = placeInSearch(globalThis.location.search);
    const saved = savedEndpoint(globalThis.history.state);
    if (place.service === undefined || saved === undefined) return;
    const { state: now, commands: act } = latest.current;
    resuming.current = go(place, saved, now, act, follow) === "went";
  }, []);

  // Once arrived somewhere, the address says where.
  useEffect(() => {
    if (inTransit(state)) return;
    if (watching.current) {
      if (state.stage === "process") return;
      watching.current = false;
    }
    if (resuming.current) {
      if (state.stage === "choose-endpoint" && state.error === undefined) return;
      resuming.current = false;
    }
    const place = withoutRemoved(placeOf(state), removed.current);
    const shown = placeInSearch(globalThis.location.search);
    if (samePlace(place, shown)) return;
    // A link's place stays in the address until the user connects or leaves it.
    if (state.stage === "choose-endpoint" && linked !== undefined) return;
    const saved: Saved = { oapEndpoint: endpointOf(state) };
    const { pathname, hash } = globalThis.location;
    globalThis.history.pushState(
      saved,
      "",
      `${pathname}${withPlace(globalThis.location.search, place)}${hash}`,
    );
  }, [state, linked]);

  // Back and Forward: to the place the address now names.
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const { state: now, commands: act } = latest.current;
      const place = placeInSearch(globalThis.location.search);
      if (wouldLoseWork(now) && now.stage === "running") {
        // A run under way is not left by Back: the address goes back to it.
        // A background job with a link is: it goes on in My jobs.
        const { pathname, hash } = globalThis.location;
        const here = withPlace(globalThis.location.search, placeOf(now));
        globalThis.history.pushState(
          { oapEndpoint: now.endpoint },
          "",
          `${pathname}${here}${hash}`,
        );
        return;
      }
      if (go(place, savedEndpoint(event.state), now, act, follow) === "not-saved") {
        // The link this page was opened with: ask again, as on arrival.
        if (now.stage !== "choose-endpoint") act.disconnect();
        setLinked(place);
      } else {
        setLinked(undefined);
      }
    };
    globalThis.addEventListener("popstate", onPop);
    return () => {
      globalThis.removeEventListener("popstate", onPop);
    };
  }, []);

  // Leaving with something to lose: the browser asks first.
  const atRisk = wouldLoseWork(state);
  useEffect(() => {
    if (!atRisk) return undefined;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    globalThis.addEventListener("beforeunload", onLeave);
    return () => {
      globalThis.removeEventListener("beforeunload", onLeave);
    };
  }, [atRisk]);

  const connect = (endpoint: EndpointRef) => {
    const link = linked;
    setLinked(undefined);
    if (
      link?.service !== undefined &&
      link.process !== undefined &&
      plain(link.service) === plain(endpoint.baseUrl)
    ) {
      if (link.job !== undefined) {
        follow({
          service: endpoint.baseUrl,
          process: link.process,
          statusUrl: jobUrl(endpoint.baseUrl, link.job),
        });
      }
      commands.openExample(endpoint, link.process);
    } else {
      commands.connect(endpoint);
    }
  };

  const followJob = (endpoint: EndpointRef, processId: string, statusUrl: string) => {
    follow({ service: endpoint.baseUrl, process: processId, statusUrl });
    commands.openExample(endpoint, processId);
  };

  const removeJob = (statusUrl: string) => {
    commands.removeJob(statusUrl);
    removed.current.add(statusUrl);
    // A reload may still be on its way back to this job, to follow it once its
    // process is open: it would list the job again. Not any more.
    if (following.current?.statusUrl === statusUrl) following.current = undefined;
    const shown = placeInSearch(globalThis.location.search);
    const kept = withoutRemoved(shown, removed.current);
    if (samePlace(kept, shown)) return;
    // In place: Back should not lead to an entry that names it either.
    const { pathname, hash } = globalThis.location;
    globalThis.history.replaceState(
      globalThis.history.state,
      "",
      `${pathname}${withPlace(globalThis.location.search, kept)}${hash}`,
    );
  };

  return { linked, connect, followJob, removeJob };
}
