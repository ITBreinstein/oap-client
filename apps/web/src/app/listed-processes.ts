/**
 * What the process list shows for a configured endpoint that names its
 * processes (the relay config's `processes`): only those, in the server's
 * order, and what was left out, so the screen can say so.
 *
 * Presentation, not access. Applied as the list is drawn, never to the
 * workflow's own list, which stays the whole list the server gave: the
 * census still describes every process the server lists, and an example
 * still opens a process the configuration leaves out.
 */

import type { ProcessList } from "@breinstein/oap-client";
import type { EndpointRef } from "./workflow.js";

/**
 * How a configured process list narrowed what the server offers. How many are
 * shown, and whether the read was cut short, are on the narrowed list itself.
 */
export interface ListFilter {
  /** How many processes the client read, before narrowing. */
  readonly read: number;
  /**
   * Configured ids not among those read. On a list cut short they may still be
   * on the server, on a page that was not read.
   */
  readonly missing: readonly string[];
  /** False when none of the configured ids was read, so the whole list is shown. */
  readonly applied: boolean;
}

/**
 * The list to show. For a configured endpoint that names its processes, only
 * those, and a note of what was left out. Anything else is shown whole. So is
 * the list when none of the configured ids was read — renamed, or misspelt in
 * the config — rather than leaving the page with nothing to open.
 */
export function listedProcesses(
  endpoint: EndpointRef,
  list: ProcessList,
): { readonly processes: ProcessList; readonly listFilter: ListFilter | undefined } {
  if (endpoint.source !== "configured" || endpoint.processes === undefined) {
    return { processes: list, listFilter: undefined };
  }
  const wanted = new Set(endpoint.processes);
  const kept = list.processes.filter((summary) => wanted.has(summary.id));
  const present = new Set(list.processes.map((summary) => summary.id));
  const applied = kept.length > 0;
  return {
    processes: applied ? { ...list, processes: kept } : list,
    listFilter: {
      read: list.processes.length,
      missing: endpoint.processes.filter((id) => !present.has(id)),
      applied,
    },
  };
}

/** On a list cut short, an id not read may still be on a page that was not. */
function missingWhere(list: ProcessList): string {
  return list.truncated ? "not among those read" : "not on the server";
}

/**
 * The count line for a narrowed list: one count, never two that disagree.
 * The server's `numberTotal` only when it is more than was read.
 */
export function narrowedCount(filter: ListFilter, list: ProcessList): string {
  const total = list.numberTotal;
  const reports =
    total !== undefined && total > filter.read ? ` (it reports ${String(total)})` : "";
  const cutShort = list.truncated
    ? " — the list was cut short after too many pages, so configured processes on the pages not read are not shown"
    : "";
  const missing =
    filter.missing.length > 0
      ? ` Configured but ${missingWhere(list)}: ${filter.missing.join(", ")}.`
      : "";
  return `${String(list.processes.length)} of the ${String(filter.read)} processes this server lists, as configured for this service${reports}${cutShort}.${missing}`;
}

/** What the page says when none of the configured ids was read, and it lists them all. */
export function unappliedNote(filter: ListFilter, list: ProcessList): string {
  const where = list.truncated ? "among those read" : "on the server";
  return `None of the processes configured for this service is ${where}, so all are listed. Configured: ${filter.missing.join(", ")}.`;
}
