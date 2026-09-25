/** The service's processes (S2). */

import type { ProcessList, ProcessSummary, ServiceDescription } from "@breinstein/oap-client";
import { useId, useState } from "react";
import { ErrorMessage } from "./ErrorMessage.js";
import type { EndpointRef, ListFilter, WorkflowError } from "./workflow.js";

export interface ProcessListScreenProps {
  readonly endpoint: EndpointRef;
  readonly service: ServiceDescription;
  readonly processes: ProcessList;
  /** Set when this service's configuration lists only some of its processes. */
  readonly listFilter?: ListFilter | undefined;
  readonly opening: string | undefined;
  readonly error: WorkflowError | undefined;
  readonly onOpen: (summary: ProcessSummary) => void;
  readonly onDisconnect: () => void;
}

export function ProcessListScreen(props: ProcessListScreenProps) {
  const { endpoint, service, processes, listFilter, opening, error, onOpen, onDisconnect } = props;
  const base = useId();
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = processes.processes.filter(
    (process) =>
      needle === "" ||
      process.id.toLowerCase().includes(needle) ||
      (process.title ?? "").toLowerCase().includes(needle),
  );
  const count = processes.processes.length;
  const total = processes.numberTotal;
  const cutShort = processes.truncated;
  // On a list cut short, an id not read may still be on a page that was not.
  const missingLabel = cutShort ? "not among those read" : "not on the server";

  return (
    <section aria-labelledby={`${base}-heading`}>
      <p className="breadcrumb">
        Connected to <strong>{service.title ?? endpoint.baseUrl}</strong>{" "}
        <button type="button" className="link" onClick={onDisconnect}>
          Change service
        </button>
      </p>
      <h2 id={`${base}-heading`} tabIndex={-1} data-focus-on-stage>
        Processes
      </h2>
      {service.description !== undefined && <p className="help">{service.description}</p>}
      {listFilter?.applied === true ? (
        <p className="muted" data-testid="list-filter">
          {`${String(count)} of the ${String(listFilter.read)} processes this server lists, as configured for this service`}
          {total !== undefined && total > listFilter.read && ` (it reports ${String(total)})`}
          {cutShort &&
            " — the list was cut short after too many pages, so configured processes on the pages not read are not shown"}
          .
          {listFilter.missing.length > 0 &&
            ` Configured but ${missingLabel}: ${listFilter.missing.join(", ")}.`}
        </p>
      ) : (
        <>
          {listFilter !== undefined && (
            <p className="muted" data-testid="list-filter">
              {`None of the processes configured for this service is ${cutShort ? "among those read" : "on the server"}, so all are listed. Configured: ${listFilter.missing.join(", ")}.`}
            </p>
          )}
          <p className="muted">
            {count === 1 ? "1 process" : `${String(count)} processes`}
            {total !== undefined && total > count && ` of ${String(total)} the server reports`}
            {cutShort && " — the list was cut short after too many pages; some are not shown"}.
          </p>
        </>
      )}
      {count > 8 && (
        <p>
          <label htmlFor={`${base}-filter`}>Filter by id or title</label>
          <input
            id={`${base}-filter`}
            type="search"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
        </p>
      )}
      <ErrorMessage error={error} />
      {opening !== undefined && (
        <p role="status" className="status">
          Reading the description of {opening}…
        </p>
      )}
      <ul className="process-list">
        {shown.map((process) => (
          <li key={process.id}>
            <button
              type="button"
              className="link process-link"
              disabled={opening !== undefined}
              onClick={() => {
                onOpen(process);
              }}
            >
              {process.title ?? process.id}
            </button>{" "}
            <code className="muted">{process.id}</code>
            {process.description !== undefined && <p className="help">{process.description}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
