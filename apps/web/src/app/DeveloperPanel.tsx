/**
 * The developer panel (T4): the session's observations, filtered by endpoint
 * and kind, and a way to take them away as a file — the whole session, or one
 * endpoint, which is what the interoperability matrix is built from. Also the
 * process census, and the raw asynchronous-execution panel from Task 6, kept
 * as a developer view because the relay's browser tests drive it.
 *
 * Collapsed unless the page was opened with `?developer`, so the demo shows
 * the workflow and not its plumbing.
 */

import { VERSION } from "@breinstein/oap-client";
import { useId, useState } from "react";
import { AsyncJobPanel } from "../jobs/AsyncJobPanel.js";
import {
  kindCounts,
  observationExport,
  observedEndpoints,
  type SessionObservation,
} from "../observations.js";
import { saveBlob } from "./save.js";
import type { CensusProgress } from "./useWorkflow.js";

/** Enough to see what just happened; the download has the rest. */
const SHOWN = 50;

function download(observations: readonly SessionObservation[], endpoint?: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const host = endpoint === undefined ? undefined : endpoint.replace(/^[a-z]+:\/\//, "");
  const name =
    host === undefined
      ? `oap-client-observations-${stamp}.json`
      : `oap-client-observations-${host.replace(/[^A-Za-z0-9.-]+/g, "_")}-${stamp}.json`;
  const blob = new Blob([observationExport(observations, VERSION, undefined, endpoint)], {
    type: "application/json",
  });
  saveBlob(blob, name);
}

function censusMessage(census: CensusProgress): string {
  const failed = census.failed === 0 ? "" : `, ${String(census.failed)} could not be read`;
  const done = census.running ? "…" : ".";
  return `Process census of ${census.endpoint}: ${String(census.described)} of ${String(census.total)} described${failed}${done}`;
}

export function DeveloperPanel({
  observations,
  relayUrl,
  open,
  census,
  onDescribeAll,
}: {
  readonly observations: readonly SessionObservation[];
  readonly relayUrl: string | undefined;
  readonly open: boolean;
  readonly census: CensusProgress | undefined;
  /** Absent while nothing is connected: there is no process list to walk. */
  readonly onDescribeAll: (() => void) | undefined;
}) {
  const [endpoint, setEndpoint] = useState("");
  const [kind, setKind] = useState("");
  const endpointId = useId();
  const kindId = useId();
  const forms = observations.filter((entry) => entry.observation.kind === "form").length;
  const endpoints = observedEndpoints(observations);
  const scoped =
    endpoint === "" ? observations : observations.filter((entry) => entry.endpoint === endpoint);
  const kinds = kindCounts(scoped);
  const shown = kind === "" ? scoped : scoped.filter((entry) => entry.observation.kind === kind);
  const latest = shown.slice(-SHOWN).reverse();
  return (
    <details className="developer" open={open}>
      <summary>Developer</summary>
      <p>
        {observations.length} observations this session, {forms} from form generation.
      </p>
      <p className="developer-filters">
        <label htmlFor={endpointId}>Observations from</label>
        <select
          id={endpointId}
          value={endpoint}
          onChange={(event) => {
            setEndpoint(event.target.value);
            setKind("");
          }}
        >
          <option value="">All endpoints</option>
          {endpoints.map((each) => (
            <option key={each} value={each}>
              {each}
            </option>
          ))}
        </select>
        <label htmlFor={kindId}>Observation kind</label>
        <select
          id={kindId}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
          }}
        >
          <option value="">All kinds ({scoped.length})</option>
          {kinds.map((each) => (
            <option key={each.kind} value={each.kind}>
              {each.kind} ({each.count})
            </option>
          ))}
        </select>
      </p>
      <p className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            download(observations);
          }}
        >
          Download session observations
        </button>
        {endpoint !== "" && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              download(observations, endpoint);
            }}
          >
            Download this endpoint's observations
          </button>
        )}
        {onDescribeAll !== undefined && (
          <button
            type="button"
            className="secondary"
            disabled={census?.running === true}
            onClick={onDescribeAll}
          >
            Describe every process
          </button>
        )}
      </p>
      {census !== undefined && <p role="status">{censusMessage(census)}</p>}
      {latest.length > 0 && (
        <>
          <p className="muted">
            {shown.length > SHOWN
              ? `The latest ${String(SHOWN)} of ${String(shown.length)}, newest first. Every one is in the download.`
              : "Newest first."}
          </p>
          <ol className="observation-list">
            {latest.map((entry, index) => (
              // Observations have no identity of their own; the list only
              // ever grows at the end, so newest-first positions are stable
              // enough for a read-only view.
              <li key={shown.length - index}>
                <details>
                  <summary>
                    <code>{entry.observation.kind}</code>{" "}
                    <span className="muted">{entry.endpoint}</span>
                  </summary>
                  <pre>{JSON.stringify(entry.observation, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
      <AsyncJobPanel relayUrl={relayUrl} />
    </details>
  );
}
