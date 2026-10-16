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
  /**
   * Its own "My jobs" heading. Off inside the My jobs panel, whose heading
   * names it already.
   */
  readonly heading?: boolean | undefined;
  /**
   * STYLE TRIAL: the updated Instrument's rows: a title with the status as a
   * badge beside it, then one labelled line per fact.
   */
  readonly structured?: boolean | undefined;
  /**
   * STYLE TRIAL (updated Instrument): run a job's process again. `filled`
   * says whether its inputs are known (a job started this visit), so the
   * button says what it will do; `busy` while a run can't be left.
   */
  readonly rerun?:
    | {
        readonly start: (job: JobRow) => void;
        readonly filled: (job: JobRow) => boolean;
        readonly busy: boolean;
      }
    | undefined;
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

/** STYLE TRIAL (updated Instrument): a job's title and status, then its facts, one to a line. */
function JobFacts({
  job,
  titleId,
  title,
}: {
  readonly job: JobRow;
  readonly titleId: string;
  readonly title: string;
}) {
  const { status } = job;
  const state = job.gone ? "gone" : (status?.status ?? "checking");
  return (
    <>
      <p className="job-top">
        <strong className="job-title" id={titleId}>
          {title}
        </strong>
        <span className="job-badge" role="status" data-job-state={state}>
          <strong data-job-status={status?.status}>
            {job.gone ? "gone" : (status?.rawStatus ?? "checking…")}
          </strong>
          {job.confirmation?.state === "pending" && (
            <span data-not-yet-confirmed="true"> · not yet confirmed</span>
          )}
        </span>
      </p>
      <dl className="job-facts">
        <div>
          <dt>Service</dt>
          <dd>{hostOf(job.endpoint)}</dd>
        </div>
        {job.startedAt !== undefined && (
          <div>
            <dt>Started</dt>
            <dd>
              <time dateTime={job.startedAt}>{startedLabel(job.startedAt)}</time>
            </dd>
          </div>
        )}
        {status?.progress !== undefined && (
          <div>
            <dt>Progress</dt>
            <dd className="job-progress">{status.progress}%</dd>
          </div>
        )}
        {status?.message !== undefined && (
          <div>
            <dt>Message</dt>
            <dd>{status.message}</dd>
          </div>
        )}
        {job.gone && (
          <div>
            <dt>Server</dt>
            <dd>No longer there: dismissed, or expired.</dd>
          </div>
        )}
        {job.lastError !== undefined && (
          <div>
            <dt>Last read</dt>
            <dd>Failed: {job.lastError}</dd>
          </div>
        )}
      </dl>
    </>
  );
}

function JobItem({
  job,
  active,
  advertisedBy,
  message,
  structured,
  onRerun,
  rerunFilled,
  rerunBusy,
  onRemove,
  onDismiss,
}: {
  readonly structured: boolean;
  readonly onRerun: (() => void) | undefined;
  readonly rerunFilled: boolean;
  readonly rerunBusy: boolean;
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
      {structured ? (
        <JobFacts job={job} titleId={`${base}-title`} title={title} />
      ) : (
        <>
          {/* One cell each, so a style can lay a row out as a table's. */}
          <p className="job-head">
            <strong className="job-title" id={`${base}-title`}>
              {title}
            </strong>{" "}
            <span className="muted job-service">on {hostOf(job.endpoint)}</span>
            {job.startedAt !== undefined && (
              <span className="muted job-started">
                <span className="job-sep">, </span>started{" "}
                <time dateTime={job.startedAt}>{startedLabel(job.startedAt)}</time>
              </span>
            )}
          </p>
          <p role="status" className="job-status">
            <StatusText job={job} />
          </p>
        </>
      )}
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
          {onRerun !== undefined && (
            <>
              <button
                type="button"
                className="secondary"
                disabled={rerunBusy}
                title={
                  rerunBusy
                    ? "A run is under way."
                    : rerunFilled
                      ? "Opens the process with this job's inputs filled in, ready to run."
                      : "Its inputs aren't kept between visits: the process opens with an empty form."
                }
                onClick={onRerun}
              >
                {rerunFilled ? "Run again" : "Open the process"}
              </button>{" "}
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
  const heading = props.heading !== false;
  return (
    <section
      className="jobs-panel"
      aria-labelledby={heading ? `${base}-heading` : undefined}
      aria-label={heading ? undefined : "My jobs"}
      data-testid="my-jobs"
    >
      {heading && <h2 id={`${base}-heading`}>My jobs</h2>}
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
            structured={props.structured === true}
            onRerun={
              props.rerun === undefined || job.processId === undefined
                ? undefined
                : () => {
                    props.rerun?.start(job);
                  }
            }
            rerunFilled={props.rerun?.filled(job) === true}
            rerunBusy={props.rerun?.busy === true}
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
