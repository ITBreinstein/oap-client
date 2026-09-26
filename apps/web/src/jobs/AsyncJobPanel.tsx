/**
 * Start an asynchronous job and watch it — the smallest UI that exercises the
 * whole relay integration from a real browser: route choice, job identity, doorbells
 * and reconciliation.
 *
 * Deliberately plain. It is the surface the browser end-to-end test drives and
 * a place to see the relay working, not the product's job panel; that one is
 * built on the same `JobSession` and replaces this.
 */

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { RelayEndpoint } from "../relay/contract.js";
import {
  createJobSession,
  type JobSession,
  type JobSessionSnapshot,
} from "../relay/job-session.js";

const MANUAL_KEY = "manual";

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text === "" ? "{}" : text);
  } catch {
    throw new Error(`${label} is not JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  // Spread into a fresh record so the type follows from the checks above.
  return { ...value };
}

export function AsyncJobPanel({ relayUrl }: { readonly relayUrl: string | undefined }) {
  // Made inside the effect, not in useMemo: StrictMode runs effects twice in
  // development, and a memoised session would be disposed by the first
  // cleanup and then reused by the second run. A ref, because nothing renders
  // from it — the snapshots it publishes are the state.
  const session = useRef<JobSession | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<JobSessionSnapshot | undefined>();
  const [endpoints, setEndpoints] = useState<RelayEndpoint[]>([]);
  const [endpointKey, setEndpointKey] = useState(MANUAL_KEY);
  const [manualBase, setManualBase] = useState("http://localhost:5080");
  const [processId, setProcessId] = useState("slow");
  const [inputs, setInputs] = useState('{"seconds": 3}');
  const [outputs, setOutputs] = useState("{}");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const created = createJobSession(relayUrl);
    session.current = created;
    const unsubscribe = created.subscribe(setSnapshot);
    let live = true;
    created
      .endpoints()
      .then((list) => {
        if (!live) return;
        setEndpoints(list);
        const first = list[0];
        if (first !== undefined) setEndpointKey(first.key);
      })
      .catch(() => {
        if (live) setError("the relay did not list its endpoints; using a direct endpoint");
      });
    return () => {
      live = false;
      unsubscribe();
      created.dispose();
      if (session.current === created) session.current = undefined;
    };
  }, [relayUrl]);

  const onSubmit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const current = session.current;
    if (current === undefined) return;
    setError(undefined);
    const endpoint: RelayEndpoint = endpoints.find((entry) => entry.key === endpointKey) ?? {
      key: MANUAL_KEY,
      baseUrl: manualBase.replace(/\/+$/, ""),
      executeRoute: "direct",
      readRoute: "direct",
      callbacks: false,
    };
    let parsedInputs: Record<string, unknown>;
    let parsedOutputs: Record<string, unknown>;
    try {
      parsedInputs = parseObject(inputs, "Inputs");
      parsedOutputs = parseObject(outputs, "Outputs");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setBusy(true);
    current
      .run(endpoint, processId, parsedInputs, parsedOutputs)
      .then((execution) => {
        if (execution.kind !== "job") setError("the server ran it synchronously; no job to watch");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section aria-labelledby="async-heading">
      <h2 id="async-heading">Asynchronous execution</h2>
      <p data-testid="relay-state">
        Relay:{" "}
        {relayUrl === undefined
          ? "off — jobs are found by polling"
          : (snapshot?.relay ?? "starting")}
      </p>

      <form onSubmit={onSubmit}>
        <label>
          Endpoint{" "}
          <select
            data-testid="endpoint"
            value={endpointKey}
            onChange={(event) => {
              setEndpointKey(event.target.value);
            }}
          >
            {endpoints.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.key} — {entry.executeRoute}
                {entry.callbacks ? ", callbacks" : ""}
              </option>
            ))}
            <option value={MANUAL_KEY}>another server, direct</option>
          </select>
        </label>
        {endpointKey === MANUAL_KEY && (
          <label>
            {" "}
            Base URL{" "}
            <input
              data-testid="manual-base"
              value={manualBase}
              onChange={(event) => {
                setManualBase(event.target.value);
              }}
            />
          </label>
        )}
        <br />
        <label>
          Process{" "}
          <input
            data-testid="process-id"
            value={processId}
            onChange={(event) => {
              setProcessId(event.target.value);
            }}
          />
        </label>
        <br />
        <label>
          Inputs (JSON){" "}
          <textarea
            data-testid="inputs"
            value={inputs}
            onChange={(event) => {
              setInputs(event.target.value);
            }}
          />
        </label>
        <label>
          {" "}
          Outputs (JSON){" "}
          <textarea
            data-testid="outputs"
            value={outputs}
            onChange={(event) => {
              setOutputs(event.target.value);
            }}
          />
        </label>
        <br />
        <button type="submit" data-testid="run" disabled={busy}>
          Run asynchronously
        </button>
      </form>

      {error !== undefined && (
        <p role="alert" data-testid="error">
          {error}
        </p>
      )}

      <table data-testid="jobs">
        <thead>
          <tr>
            <th>Job</th>
            <th>Endpoint</th>
            <th>Route</th>
            <th>Status</th>
            <th>Polls</th>
            <th>Doorbells</th>
          </tr>
        </thead>
        <tbody>
          {(snapshot?.jobs ?? []).map((job) => (
            <tr
              key={job.statusUrl}
              data-testid="job"
              data-job-id={job.status?.jobId ?? ""}
              data-status={job.gone ? "gone" : (job.status?.status ?? "")}
              data-route={job.route ?? ""}
              data-doorbells={job.doorbells}
            >
              <td>
                <a href={job.statusUrl}>{job.status?.jobId ?? job.statusUrl}</a>
              </td>
              <td>{job.endpointKey}</td>
              <td>{job.route ?? "?"}</td>
              <td>
                {job.gone ? "gone" : (job.status?.rawStatus ?? "…")}
                {job.lastError === undefined ? "" : ` (last read failed: ${job.lastError})`}
              </td>
              <td>{job.polls}</td>
              <td>{job.ref === undefined ? "—" : job.doorbells}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details>
        <summary>Observations</summary>
        <pre data-testid="observations">
          {JSON.stringify(snapshot?.observations ?? [], null, 2)}
        </pre>
      </details>
    </section>
  );
}
