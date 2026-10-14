/**
 * Examples: processes offered on the start screen, each opened with one click
 * (`config.json`'s `examples`). What to show, and what a search finds.
 */

import type { Example } from "../config/runtime-config.js";
import type { Needs } from "./needs.js";

/** The start screen shows at most this many; the rest are under "Browse all". */
export const MAX_FEATURED = 4;

export type NeedsFilter = Needs | "all";

/** The first {@link MAX_FEATURED} flagged `featured`, in file order. */
export function featuredExamples(examples: readonly Example[]): Example[] {
  return examples.filter((example) => example.featured).slice(0, MAX_FEATURED);
}

/**
 * The examples a search and a filter leave. The search finds words in the
 * title, the summary or the process id, ignoring case; an example whose needs
 * are not stated is found under "all" only.
 */
export function filterExamples(
  examples: readonly Example[],
  query: string,
  needs: NeedsFilter,
): Example[] {
  const needle = query.trim().toLowerCase();
  return examples.filter(
    (example) =>
      (needs === "all" || example.needs === needs) &&
      (needle === "" ||
        example.title.toLowerCase().includes(needle) ||
        example.summary.toLowerCase().includes(needle) ||
        example.process.toLowerCase().includes(needle)),
  );
}

export interface ServiceGroup {
  readonly service: string;
  readonly examples: readonly Example[];
}

/** The examples by service, services in the order first listed. */
export function groupByService(examples: readonly Example[]): ServiceGroup[] {
  const groups = new Map<string, Example[]>();
  for (const example of examples) {
    const group = groups.get(example.service);
    if (group === undefined) groups.set(example.service, [example]);
    else group.push(example);
  }
  return [...groups].map(([service, list]) => ({ service, examples: list }));
}

/** A service's address without its scheme: short enough for a label, still exact. */
export function serviceLabel(service: string): string {
  try {
    const url = new URL(service);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return service;
  }
}

/** What the examples say each process at `service` needs, by process id. */
export function exampleNeeds(examples: readonly Example[], service: string): Map<string, Needs> {
  const needs = new Map<string, Needs>();
  for (const example of examples) {
    if (example.service === service && example.needs !== undefined) {
      needs.set(example.process, example.needs);
    }
  }
  return needs;
}
