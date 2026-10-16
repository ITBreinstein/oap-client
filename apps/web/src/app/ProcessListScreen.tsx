/**
 * The service's processes (S2).
 *
 * Coming back from a process lands on that process, not on the top of the
 * list: with hundreds of processes (ZOO lists some 700), the place is worth
 * keeping. Processes run on this connection are marked, so working through a
 * service shows what has been tried.
 *
 * First, what the page knows of the service: how it is reached, how it runs
 * jobs, how many processes it lists and which version of the standard it
 * declares. Then one row per process, with only what the list itself says or
 * this page already knows: its title and id, how it runs, whether it ran this
 * visit, and what it needs from you where that is known. No description is
 * fetched to fill a column.
 */

import type {
  ProcessList,
  ProcessSummary,
  ServiceCapabilities,
  ServiceDescription,
} from "@breinstein/oap-client";
import { useId, useState } from "react";
import { ErrorMessage } from "./ErrorMessage.js";
import type { Needs } from "./needs.js";
import { NeedsTag } from "./NeedsTag.js";
import type { EndpointRef, WorkflowError } from "./workflow.js";

export interface ProcessListScreenProps {
  readonly endpoint: EndpointRef;
  readonly service: ServiceDescription;
  readonly processes: ProcessList;
  readonly opening: string | undefined;
  /** How this connection reads the server: direct, or through the relay. */
  readonly route?: "direct" | "relay" | undefined;
  /** The process opened last on this connection, if any. */
  readonly lastOpened?: string | undefined;
  /** The processes run to a result on this connection. */
  readonly ran?: readonly string[] | undefined;
  /** What each process needs, by id, where this page knows it. */
  readonly needs?: ReadonlyMap<string, Needs> | undefined;
  readonly error: WorkflowError | undefined;
  readonly onOpen: (summary: ProcessSummary) => void;
  readonly onDisconnect: () => void;
}

/** How a process says it runs, from the list: the spec's own words, shortened. */
export function runsLabel(summary: ProcessSummary): string | undefined {
  const { execution } = summary;
  if (execution.declared.length === 0) return undefined;
  return [execution.sync && "sync", execution.async && "async"].filter(Boolean).join(" · ");
}

/** How the service runs jobs, from what it declares and what its Core class implies. */
export function jobsLabel(capabilities: ServiceCapabilities): string {
  const modes = [
    capabilities.sync && "sync",
    capabilities.async && "async",
    capabilities.dismiss && "dismiss",
    capabilities.callback && "callback",
  ].filter(Boolean);
  return modes.length === 0 ? "none declared" : modes.join(" · ");
}

/**
 * Which part and version of OGC API - Processes the service declares, in the
 * conformance URIs' own words (`ogcapi-processes-1/1.0`), with how many
 * classes it declares in all.
 */
export function standardLabel(capabilities: ServiceCapabilities): string {
  const declared = capabilities.rawConformance;
  if (declared.length === 0) return "none declared";
  const parts = [
    ...new Set(
      declared.flatMap((uri) => {
        const match = /\/spec\/(ogcapi-processes-\d+)\/([\d.]+)\//.exec(uri);
        return match === null ? [] : [`${match[1] ?? ""}/${match[2] ?? ""}`];
      }),
    ),
  ];
  const classes = declared.length === 1 ? "1 class" : `${String(declared.length)} classes`;
  return parts.length === 0
    ? `${classes}, none of OGC API - Processes`
    : `${parts.join(", ")} · ${classes}`;
}

export function ProcessListScreen(props: ProcessListScreenProps) {
  const { endpoint, service, processes, opening, error, onOpen, onDisconnect } = props;
  const ran = props.ran ?? [];
  const base = useId();
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = processes.processes.filter(
    (process) =>
      needle === "" ||
      process.id.toLowerCase().includes(needle) ||
      (process.title ?? "").toLowerCase().includes(needle),
  );
  const total = processes.numberTotal;
  // Where focus lands when this screen appears (App moves it): the process
  // the user came back from, when it is listed, else the heading.
  const returnTo = shown.some((process) => process.id === props.lastOpened)
    ? props.lastOpened
    : undefined;
  const count =
    processes.processes.length === 1
      ? "1 process"
      : `${String(processes.processes.length)} processes`;

  return (
    <section className="process-list-screen" aria-labelledby={`${base}-heading`}>
      <p className="breadcrumb">
        Connected to <strong>{service.title ?? endpoint.baseUrl}</strong>{" "}
        <button type="button" className="link" onClick={onDisconnect}>
          Change service
        </button>
      </p>
      <h2
        id={`${base}-heading`}
        tabIndex={-1}
        data-focus-on-stage={returnTo === undefined ? true : undefined}
      >
        Processes
      </h2>

      <div className="service-card card">
        <div className="service-main">
          <p className="service-title">{service.title ?? endpoint.baseUrl}</p>
          <p className="service-url mono">{endpoint.baseUrl}</p>
          {service.description !== undefined && <p className="help">{service.description}</p>}
        </div>
        <dl className="service-facts">
          <div>
            <dt className="label">Access</dt>
            <dd>{props.route === "relay" ? "through the relay" : "direct"}</dd>
          </div>
          <div>
            <dt className="label">Jobs</dt>
            <dd className="mono">{jobsLabel(service.capabilities)}</dd>
          </div>
          <div>
            <dt className="label">Processes</dt>
            <dd className="mono">{String(total ?? processes.processes.length)}</dd>
          </div>
          <div>
            <dt className="label">Standard</dt>
            <dd className="mono">{standardLabel(service.capabilities)}</dd>
          </div>
        </dl>
      </div>

      <div className="list-tools">
        {processes.processes.length > 8 && (
          <p className="search-field">
            <label htmlFor={`${base}-filter`}>Search processes</label>
            <input
              id={`${base}-filter`}
              type="search"
              placeholder="Title or identifier"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
          </p>
        )}
        <p className="muted list-count">
          {count}
          {total !== undefined &&
            total > processes.processes.length &&
            ` of ${String(total)} the server reports`}
          {processes.truncated &&
            " — the list was cut short after too many pages; some are not shown"}
          .
        </p>
      </div>
      <ErrorMessage error={error} tone={error?.notice === true ? "notice" : "error"} />
      {opening !== undefined && (
        <p role="status" className="status">
          Reading the description of {opening}…
        </p>
      )}
      <div className="process-table">
        {/* The column heads, for sight only: each row names its own cells. */}
        <p className="process-head" aria-hidden="true">
          <span className="label">Process</span>
          <span className="label">Needs</span>
          <span className="label">Runs</span>
          <span className="label">This visit</span>
        </p>
        <ul className="process-list">
          {shown.map((process) => {
            const runs = runsLabel(process);
            const needs = props.needs?.get(process.id);
            return (
              <li key={process.id} data-last-opened={process.id === returnTo ? true : undefined}>
                <span className="cell cell-process">
                  <button
                    type="button"
                    className="link process-link"
                    disabled={opening !== undefined}
                    data-focus-on-stage={process.id === returnTo ? true : undefined}
                    onClick={() => {
                      onOpen(process);
                    }}
                  >
                    {process.title ?? process.id}
                  </button>{" "}
                  <code className="process-id">{process.id}</code>
                  {process.description !== undefined && (
                    <span className="help process-description">{process.description}</span>
                  )}
                </span>
                <span className="cell cell-needs" data-known={needs !== undefined}>
                  <span className="visually-hidden">Needs: </span>
                  <NeedsTag needs={needs} />
                </span>
                <span className="cell cell-runs mono">
                  <span className="visually-hidden">Runs: </span>
                  {runs ?? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="visually-hidden">not stated</span>
                    </>
                  )}
                </span>
                <span className="cell cell-ran">
                  {ran.includes(process.id) && (
                    <span className="tag" data-ran="true">
                      <span aria-hidden="true">✓ </span>Ran
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
