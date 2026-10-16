/**
 * The page's place in its own address: `?service=…` once connected, and
 * `&process=…` once a process is open. So a reload comes back to the same
 * place, Back and Forward move between the places visited, and a place can
 * be passed on as a link. Every other parameter (`style`, `theme`,
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
 */

import { useEffect, useRef, useState } from "react";
import { typedEndpoint } from "./run.js";
import type { WorkflowCommands } from "./useWorkflow.js";
import type { EndpointRef, Workflow } from "./workflow.js";

/** Where the page is: a service, and a process there. */
export interface Place {
  readonly service?: string | undefined;
  readonly process?: string | undefined;
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
      (b.service === undefined ? undefined : plain(b.service)) && a.process === b.process
  );
}

/** The place a workflow state is at. */
export function placeOf(state: Workflow): Place {
  switch (state.stage) {
    case "choose-endpoint":
      return {};
    case "connected":
      return { service: state.endpoint.baseUrl };
    case "process":
    case "running":
    case "result":
      return { service: state.endpoint.baseUrl, process: state.process.id };
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
 * ignored, and a `process` without a service means nothing.
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
  return process === undefined || process === "" ? { service } : { service, process };
}

/** `search` with the place in it, every other parameter kept, in its order. */
export function withPlace(search: string, place: Place): string {
  const params = new URLSearchParams(search);
  params.delete("service");
  params.delete("process");
  if (place.service !== undefined) params.set("service", place.service);
  if (place.process !== undefined) params.set("process", place.process);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** Whether leaving now would lose something: a run under way, or what was typed. */
export function wouldLoseWork(state: Workflow): boolean {
  if (state.stage === "running") return true;
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

/** Go to `place`, by the way the page saved for it, from wherever the state is. */
function go(
  place: Place,
  saved: EndpointRef | undefined,
  state: Workflow,
  commands: WorkflowCommands,
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
  /** Connect, and open the linked process when it is the linked service. */
  readonly connect: (endpoint: EndpointRef) => void;
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
    resuming.current = go(place, saved, now, act) === "went";
  }, []);

  // Once arrived somewhere, the address says where.
  useEffect(() => {
    if (inTransit(state)) return;
    if (resuming.current) {
      if (state.stage === "choose-endpoint" && state.error === undefined) return;
      resuming.current = false;
    }
    const place = placeOf(state);
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
      if (now.stage === "running") {
        // A run under way is not left by Back: the address goes back to it.
        const { pathname, hash } = globalThis.location;
        const here = withPlace(globalThis.location.search, placeOf(now));
        globalThis.history.pushState(
          { oapEndpoint: now.endpoint },
          "",
          `${pathname}${here}${hash}`,
        );
        return;
      }
      if (go(place, savedEndpoint(event.state), now, act) === "not-saved") {
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
      commands.openExample(endpoint, link.process);
    } else {
      commands.connect(endpoint);
    }
  };

  return { linked, connect };
}
