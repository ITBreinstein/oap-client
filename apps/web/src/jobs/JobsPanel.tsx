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
import { withoutExceptionCode } from "./job-message.js";
import { useSpared } from "../app/developer.js";

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
   * button says what it will do; `busy` while a run can't be left. And
   * `follow`: show a job on this page, its progress then its results, as its
   * link does.
   */
  readonly rerun?:
    | {
        readonly start: (job: JobRow) => void;
        readonly filled: (job: JobRow) => boolean;
        readonly busy: boolean;
        readonly follow?: ((job: JobRow) => void) | undefined;
      }
    | undefined;
  /**
   * STYLE TRIAL (updated Instrument, #43): a job's process and service by
   * the names a visitor knows them by, not by id and host.
   */
  readonly names?:
    ((job: JobRow) => { readonly process: string; readonly service: string }) | undefined;
  /** When this page had the server cancel a job, by its status URL (#31). */
  readonly cancelled?: ReadonlyMap<string, string> | undefined;
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

/** "Cancelled by you" and when, for a job this page had the server cancel (#31). */
function CancelledByYou({ at }: { readonly at: string }) {
  return (
    <>
      <strong data-job-status="cancelled-by-you">Cancelled by you</strong>,{" "}
      <time dateTime={at}>{startedLabel(at)}</time>
    </>
  );
}

function StatusText({
  job,
  cancelledAt,
}: {
  readonly job: JobRow;
  readonly cancelledAt: string | undefined;
}) {
  // Not "gone", nor its last progress and message: this page cancelled it.
  if (cancelledAt !== undefined) return <CancelledByYou at={cancelledAt} />;
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
      {status.message !== undefined && (
        <span className="muted"> — {withoutExceptionCode(status.message)}</span>
      )}
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
  service,
  cancelledAt,
}: {
  readonly job: JobRow;
  readonly titleId: string;
  readonly title: string;
  readonly service: string;
  readonly cancelledAt: string | undefined;
}) {
  // A job this page had the server cancel (#31): no stale progress or message.
  const cancelled = cancelledAt !== undefined;
  const status = cancelled ? undefined : job.status;
  const state = cancelled ? "cancelled" : job.gone ? "gone" : (status?.status ?? "checking");
  // JobFacts is the updated Instrument's: a visitor is spared the technical.
  const spared = useSpared(true);
  return (
    <>
      <p className="job-top">
        <strong className="job-title" id={titleId}>
          {title}
        </strong>
        <span className="job-badge" role="status" data-job-state={state}>
          {cancelled ? (
            <strong data-job-status="cancelled-by-you">cancelled by you</strong>
          ) : (
            <strong data-job-status={status?.status}>
              {/* A job leaves the server when it is cancelled, as a rule: said
                  so, rather than "gone". The line below gives the other way. */}
              {job.gone ? "cancelled" : (status?.rawStatus ?? "checking…")}
            </strong>
          )}
          {/* STYLE TRIAL (#30): for developers; the job is done. */}
          {job.confirmation?.state === "pending" && !spared && (
            <span data-not-yet-confirmed="true"> · not yet confirmed</span>
          )}
        </span>
      </p>
      <dl className="job-facts">
        <div>
          <dt>Service</dt>
          <dd>{service}</dd>
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
            <dd>{withoutExceptionCode(status.message)}</dd>
          </div>
        )}
        {cancelledAt !== undefined && (
          <div>
            <dt>Cancelled</dt>
            <dd>
              <time dateTime={cancelledAt}>{startedLabel(cancelledAt)}</time>
            </dd>
          </div>
        )}
        {job.gone && !cancelled && (
          <div>
            <dt>Server</dt>
            <dd>No longer there: cancelled, or expired.</dd>
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
  onFollow,
  rerunFilled,
  rerunBusy,
  onRemove,
  onDismiss,
  names,
  cancelled,
}: {
  readonly structured: boolean;
  readonly names: JobsPanelProps["names"];
  readonly cancelled: JobsPanelProps["cancelled"];
  readonly onRerun: (() => void) | undefined;
  readonly onFollow: (() => void) | undefined;
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
  // Not a job this browser only follows: it isn't this browser's to cancel (#32).
  const canDismiss =
    advertisedBy !== "nothing" && !job.gone && job.status?.status !== "dismissed" && !job.followed;
  const named = names?.(job);
  const cancelledAt = cancelled?.get(job.statusUrl);
  const title = named?.process ?? job.processId ?? job.status?.jobId ?? job.statusUrl;
  // Shown on the page: a job under way, or one with results, not the one on screen.
  const followable =
    !active &&
    !job.gone &&
    job.processId !== undefined &&
    (results !== undefined || job.status === undefined || !job.status.terminal);

  return (
    <li
      className="job-row"
      data-job-row={job.statusUrl}
      data-restored={job.restored ? "true" : undefined}
      aria-labelledby={`${base}-title`}
    >
      {structured ? (
        <JobFacts
          job={job}
          titleId={`${base}-title`}
          title={title}
          service={named?.service ?? hostOf(job.endpoint)}
          cancelledAt={cancelledAt}
        />
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
            <StatusText job={job} cancelledAt={cancelledAt} />
          </p>
        </>
      )}
      {/* STYLE TRIAL (updated Instrument, #33): said once, above the list, not on every row. */}
      {job.restored && !structured && (
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
          {followable && onFollow !== undefined && (
            <>
              <button
                type="button"
                className="secondary"
                disabled={rerunBusy}
                title={rerunBusy ? "A run is under way." : undefined}
                onClick={onFollow}
              >
                {results !== undefined ? "Show the results" : "Follow the job"}
              </button>{" "}
            </>
          )}
          {results !== undefined && (
            <>
              <a href={results} target="_blank" rel="noopener noreferrer">
                {onFollow === undefined ? "Results" : "Results as JSON"}
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
                {/* STYLE TRIAL (#33): "Run again" either way in the updated
                    Instrument; the form says when its inputs weren't kept. */}
                {rerunFilled || structured ? "Run again" : "Open the process"}
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
  const newestFirst = [...jobs].reverse();
  const started = newestFirst.filter((job) => !job.followed);
  const followed = newestFirst.filter((job) => job.followed);
  const item = (job: JobRow) => (
    <JobItem
      key={job.statusUrl}
      job={job}
      active={job.statusUrl === activeJob}
      advertisedBy={dismissAdvertisedFor(job)}
      message={messages.get(job.statusUrl)}
      structured={props.structured === true}
      names={props.names}
      cancelled={props.cancelled}
      onRerun={
        props.rerun === undefined || job.processId === undefined || job.followed
          ? undefined
          : () => {
              props.rerun?.start(job);
            }
      }
      onFollow={
        props.rerun?.follow === undefined
          ? undefined
          : () => {
              props.rerun?.follow?.(job);
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
  );
  return (
    <section
      className="jobs-panel"
      aria-labelledby={heading ? `${base}-heading` : undefined}
      aria-label={heading ? undefined : "My jobs"}
      data-testid="my-jobs"
    >
      {heading && <h2 id={`${base}-heading`}>My jobs</h2>}
      {/* Started here, or followed from a link (#32, #14c). */}
      <p className="help">
        Background jobs started or followed in this browser. Removing one from the list does not
        stop it on the server.
      </p>
      {/* STYLE TRIAL (updated Instrument, #33): one line for every job from an earlier visit. */}
      {props.structured === true && jobs.some((job) => job.restored) && (
        <p className="hint jobs-earlier" data-testid="jobs-earlier">
          Jobs from an earlier visit are checked every so often, rather than followed as they run.
        </p>
      )}
      {started.length > 0 && <ul>{started.map(item)}</ul>}
      {followed.length > 0 && (
        <>
          {/* Jobs this browser didn't start (#32): no Run again, no inputs of its own. */}
          <h3 className="jobs-followed-heading" id={`${base}-followed`}>
            Jobs you followed by link
          </h3>
          <ul aria-labelledby={`${base}-followed`}>{followed.map(item)}</ul>
        </>
      )}
    </section>
  );
}
