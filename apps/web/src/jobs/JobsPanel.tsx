/**
 * "My jobs": the background jobs this browser started, newest first, across
 * endpoints and across reloads.
 *
 * Each row's status is the reconciler's — read from the server, never from a
 * callback. Two actions, kept apart on purpose:
 *
 * - **Remove from list** forgets the job here. Nothing is sent anywhere, and
 *   the job carries on on the server.
 * - **Dismiss** asks the server to cancel the job (`DELETE /jobs/{id}`),
 *   after a confirmation. Offered only where dismissal is advertised — by the
 *   process or the service — or has been seen to work on that endpoint in this
 *   session.
 *
 * Only this browser's jobs: the server's own job list (`GET /jobs`) is out of
 * scope.
 */

import { resolveResultsUrl } from "@breinstein/oap-client";
import { useId, useState } from "react";
import type { DismissAdvertisedBy, JobRow } from "../relay/job-session.js";

export interface JobsPanelProps {
  readonly jobs: readonly JobRow[];
  /** The job the run on screen is waiting for: it cannot be removed from under it. */
  readonly activeJob: string | undefined;
  readonly dismissAdvertisedFor: (job: JobRow) => DismissAdvertisedBy;
  readonly messages: ReadonlyMap<string, string>;
  readonly onRemove: (statusUrl: string) => void;
  readonly onDismiss: (statusUrl: string) => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function startedLabel(startedAt: string | undefined): string {
  if (startedAt === undefined) return "";
  const date = new Date(startedAt);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The results URL for a finished job, only when it is a web address. */
function resultsHref(job: JobRow): string | undefined {
  if (job.gone || job.status?.status !== "successful") return undefined;
  const { url } = resolveResultsUrl(job.statusUrl, job.status.links);
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function StatusText({ job }: { readonly job: JobRow }) {
  if (job.gone) return <>No longer on the server: dismissed, or expired.</>;
  if (job.status === undefined) {
    return (
      <>
        Checking…
        {job.lastError !== undefined && (
          <span className="muted"> (last read failed: {job.lastError})</span>
        )}
      </>
    );
  }
  const { status } = job;
  return (
    <>
      <strong data-job-status={status.status}>{status.rawStatus}</strong>
      {job.confirmation?.state === "pending" && (
        <span className="muted" data-not-yet-confirmed="true">
          {" "}
          (not yet confirmed)
        </span>
      )}
      {status.progress !== undefined && `, ${String(status.progress)}%`}
      {status.message !== undefined && <span className="muted"> — {status.message}</span>}
      {job.lastError !== undefined && (
        <span className="muted"> (last read failed: {job.lastError})</span>
      )}
    </>
  );
}

function JobItem({
  job,
  active,
  advertisedBy,
  message,
  onRemove,
  onDismiss,
}: {
  readonly job: JobRow;
  readonly active: boolean;
  readonly advertisedBy: DismissAdvertisedBy;
  readonly message: string | undefined;
  readonly onRemove: () => void;
  readonly onDismiss: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const base = useId();
  const results = resultsHref(job);
  const canDismiss = advertisedBy !== "nothing" && !job.gone && job.status?.status !== "dismissed";
  const title = job.processId ?? job.status?.jobId ?? job.statusUrl;

  return (
    <li
      className="job-row"
      data-job-row={job.statusUrl}
      data-restored={job.restored ? "true" : undefined}
      aria-labelledby={`${base}-title`}
    >
      <p>
        <strong id={`${base}-title`}>{title}</strong>{" "}
        <span className="muted">
          on {hostOf(job.endpoint)}
          {job.startedAt !== undefined && (
            <>
              , started <time dateTime={job.startedAt}>{startedLabel(job.startedAt)}</time>
            </>
          )}
        </span>
      </p>
      <p role="status">
        <StatusText job={job} />
      </p>
      {job.restored && (
        <p className="hint">From an earlier visit: its status is polled, with no live updates.</p>
      )}
      {message !== undefined && <p className="hint">{message}</p>}

      {confirming ? (
        <div className="job-confirm" role="group" aria-label="Confirm dismissal">
          <p>
            Dismiss this job on the server? The server stops it if it is still running, and may
            delete its results. This cannot be undone.
          </p>
          <p className="actions">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDismiss();
              }}
            >
              Dismiss job
            </button>{" "}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep job
            </button>
          </p>
        </div>
      ) : (
        <p className="actions">
          {results !== undefined && (
            <>
              <a href={results} target="_blank" rel="noopener noreferrer">
                Results
              </a>{" "}
            </>
          )}
          <button
            type="button"
            className="secondary"
            disabled={active}
            title={active ? "The run on screen is waiting for this job." : undefined}
            onClick={onRemove}
          >
            Remove from list
          </button>
          {canDismiss && (
            <>
              {" "}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Dismiss…
              </button>
            </>
          )}
        </p>
      )}
    </li>
  );
}

export function JobsPanel(props: JobsPanelProps) {
  const { jobs, activeJob, dismissAdvertisedFor, messages, onRemove, onDismiss } = props;
  const base = useId();
  if (jobs.length === 0) return null;
  return (
    <section className="jobs-panel" aria-labelledby={`${base}-heading`} data-testid="my-jobs">
      <h2 id={`${base}-heading`}>My jobs</h2>
      <p className="help">
        Background jobs started from this browser. Removing one from the list does not stop it on
        the server.
      </p>
      <ul>
        {[...jobs].reverse().map((job) => (
          <JobItem
            key={job.statusUrl}
            job={job}
            active={job.statusUrl === activeJob}
            advertisedBy={dismissAdvertisedFor(job)}
            message={messages.get(job.statusUrl)}
            onRemove={() => {
              onRemove(job.statusUrl);
            }}
            onDismiss={() => {
              onDismiss(job.statusUrl);
            }}
          />
        ))}
      </ul>
    </section>
  );
}
