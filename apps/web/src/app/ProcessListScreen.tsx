/** The service's processes (S2). */

import type { ProcessList, ProcessSummary, ServiceDescription } from "@breinstein/oap-client";
import { useId, useState } from "react";
import { ErrorMessage } from "./ErrorMessage.js";
import type { EndpointRef, WorkflowError } from "./workflow.js";

export interface ProcessListScreenProps {
  readonly endpoint: EndpointRef;
  readonly service: ServiceDescription;
  readonly processes: ProcessList;
  readonly opening: string | undefined;
  readonly error: WorkflowError | undefined;
  readonly onOpen: (summary: ProcessSummary) => void;
  readonly onDisconnect: () => void;
}

export function ProcessListScreen(props: ProcessListScreenProps) {
  const { endpoint, service, processes, opening, error, onOpen, onDisconnect } = props;
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
      <p className="muted">
        {processes.processes.length === 1
          ? "1 process"
          : `${String(processes.processes.length)} processes`}
        {total !== undefined &&
          total > processes.processes.length &&
          ` of ${String(total)} the server reports`}
        {processes.truncated &&
          " — the list was cut short after too many pages; some are not shown"}
        .
      </p>
      {processes.processes.length > 8 && (
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
