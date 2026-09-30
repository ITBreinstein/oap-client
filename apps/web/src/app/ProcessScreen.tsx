/**
 * One process: what it is, its generated form, running it, and its result
 * (S2–S4).
 */

import { useId, useMemo, type SyntheticEvent } from "react";
import { schemaWarnings } from "../forms/schema-warnings.js";
import type { FieldErrors } from "../forms/validate.js";
import type { JobRow } from "../relay/job-session.js";
import { ErrorMessage } from "./ErrorMessage.js";
import { FieldView } from "./FormFields.js";
import { ResultsView } from "./ResultsView.js";
import { offersLink } from "./run.js";
import type { WorkflowCommands, WorkflowView } from "./useWorkflow.js";
import type { Workflow } from "./workflow.js";

type Open = Extract<Workflow, { stage: "process" | "running" | "result" }>;

function About({ state }: { readonly state: Open }) {
  const { process, plan } = state;
  const kinds = new Map(plan.fields.map((field) => [field.id, field.control.kind]));
  return (
    <details className="about">
      <summary>About this process</summary>
      <dl>
        <dt>Identifier</dt>
        <dd>
          <code>{process.id}</code>
          {process.version !== undefined && ` (version ${process.version})`}
        </dd>
        <dt>Can run</dt>
        <dd>
          {[
            process.execution.sync && "in the foreground",
            process.execution.async && "in the background",
          ]
            .filter(Boolean)
            .join(" and ")}
          {process.execution.dismiss && "; jobs can be cancelled"}
          {process.execution.declared.length > 0 && (
            <span className="muted"> — declared: {process.execution.declared.join(", ")}</span>
          )}
        </dd>
        <dt>Inputs</dt>
        <dd>
          {process.inputs.length === 0 ? (
            "none"
          ) : (
            <ul>
              {process.inputs.map((input) => (
                <li key={input.id}>
                  <code>{input.id}</code> {input.title !== undefined && `— ${input.title}`}{" "}
                  <span className="muted">
                    ({input.required ? "required" : "optional"}
                    {input.multiple ? `, up to ${String(input.maxOccurs)}` : ""}; shown as{" "}
                    {kinds.get(input.id) ?? "?"})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt>Outputs</dt>
        <dd>
          <ul>
            {process.outputs.map((output) => {
              const mediaType = output.schema["contentMediaType"];
              return (
                <li key={output.id}>
                  <code>{output.id}</code> {output.title !== undefined && `— ${output.title}`}
                  {typeof mediaType === "string" && <span className="muted"> ({mediaType})</span>}
                </li>
              );
            })}
          </ul>
        </dd>
      </dl>
    </details>
  );
}

/**
 * Task 8, T2: how each output comes back. Offered when the description allows
 * a reference, and then per output, value by default. Where it does not — every
 * pygeoapi process, which describes itself as value-only whatever it honours
 * (finding 0059) — only the developer view offers to ask for a link anyway,
 * and the result's record says the request went beyond the description.
 */
function OutputChoices({
  state,
  developer,
  editable,
  onChange,
}: {
  readonly state: Open;
  readonly developer: boolean;
  readonly editable: boolean;
  readonly onChange: WorkflowCommands["setTransmission"];
}) {
  const { process, linkOutputs } = state;
  const allowed = offersLink(process);
  if (process.outputs.length === 0 || (!allowed && !developer)) return null;
  if (!allowed) {
    return (
      <fieldset className="outputs developer" disabled={!editable}>
        <legend>Developer: ask for a link anyway</legend>
        <p className="muted">
          The description does not offer outputs by reference (
          {process.outputTransmission.length === 0
            ? "it declares nothing"
            : `it declares ${process.outputTransmission.join(", ")}`}
          ). Asking anyway is recorded as going beyond it.
        </p>
        {process.outputs.map((output) => (
          <label key={output.id} className="choice">
            <input
              type="checkbox"
              checked={linkOutputs.includes(output.id)}
              onChange={(event) => {
                onChange(output.id, event.target.checked ? "reference" : "value");
              }}
            />{" "}
            Ask for “{output.title ?? output.id}” as a link
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <fieldset className="outputs" disabled={!editable}>
      <legend>Outputs</legend>
      {process.outputs.map((output) => {
        const link = linkOutputs.includes(output.id);
        return (
          <fieldset key={output.id} className="output-choice" data-output-choice={output.id}>
            <legend>{output.title ?? output.id}</legend>
            <label className="choice">
              <input
                type="radio"
                name={`transmission-${output.id}`}
                checked={!link}
                onChange={() => {
                  onChange(output.id, "value");
                }}
              />{" "}
              Value
            </label>{" "}
            <label className="choice">
              <input
                type="radio"
                name={`transmission-${output.id}`}
                checked={link}
                onChange={() => {
                  onChange(output.id, "reference");
                }}
              />{" "}
              Link
            </label>
          </fieldset>
        );
      })}
    </fieldset>
  );
}

function JobStatusLine({ job }: { readonly job: JobRow | undefined }) {
  if (job === undefined) return <>Starting the job…</>;
  if (job.status === undefined) {
    return (
      <>
        Job created. Waiting for its first status
        {job.lastError === undefined ? "…" : ` (last read failed: ${job.lastError})`}
      </>
    );
  }
  const progress = job.status.progress === undefined ? "" : `, ${String(job.status.progress)}%`;
  return (
    <>
      Job <code>{job.status.jobId}</code>:{" "}
      <strong data-job-status={job.status.status}>{job.status.rawStatus}</strong>
      {progress}
      {job.status.message !== undefined && <span className="muted"> — {job.status.message}</span>}
      {job.acceptedLong && job.status.status === "accepted" && (
        // Information, not a warning: nothing is known to be wrong, and the
        // page keeps polling (finding 0032).
        <span className="hint job-accepted-note" data-accepted-long="true">
          <br />
          No progress reported yet. Some servers report <code>accepted</code> until the job
          finishes.
        </span>
      )}
    </>
  );
}

/**
 * The server said `successful`, and a second read shortly after said
 * something else (finding 0047). Both are shown, and the results read after
 * the first stay on screen: they are what the server handed out.
 */
function StatusChanged({ job }: { readonly job: JobRow | undefined }) {
  if (job?.confirmation?.state !== "changed" || job.status === undefined) return null;
  const { first } = job.confirmation;
  const now = job.status;
  return (
    <div className="notice" role="status" data-status-changed={`${first.status}->${now.status}`}>
      <p>
        The server first reported this job <strong>{first.rawStatus}</strong>, and a moment later{" "}
        <strong>{now.rawStatus}</strong>
        {now.message !== undefined && <span className="muted"> — {now.message}</span>}.
      </p>
      <p>
        The results below were read after the first report. The server&apos;s record of the job now
        says {now.rawStatus}.
      </p>
    </div>
  );
}

/** Whether the relay registered callbacks for a job; `undefined` for no job. */
function callbacksOf(job: JobRow | undefined): "registered" | "none" | undefined {
  if (job === undefined) return undefined;
  return job.ref === undefined ? "none" : "registered";
}

export interface ProcessScreenProps {
  readonly state: Open;
  readonly commands: WorkflowCommands;
  readonly fieldErrors: FieldErrors;
  readonly jobs: readonly JobRow[];
  readonly jobNotice: string | undefined;
  readonly dismissAdvertisedBy: WorkflowView["dismissAdvertisedBy"];
  /** Opened with `?developer`: offers asking for a link the description does not. */
  readonly developer?: boolean | undefined;
}

export function ProcessScreen(props: ProcessScreenProps) {
  const { state, commands, fieldErrors, jobs, jobNotice, dismissAdvertisedBy } = props;
  const developer = props.developer === true;
  const { process, plan, values, warnings, mode } = state;
  const base = useId();
  const both = process.execution.sync && process.execution.async;
  const onlyAsync = process.execution.async && !process.execution.sync;
  const editable = state.stage === "process";
  const errorCount = fieldErrors.size;
  // Recomputed only when the values change, not on every job snapshot.
  const schemaNotes = useMemo(
    () => (editable ? schemaWarnings(process, plan, values).byField : undefined),
    [editable, process, plan, values],
  );

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    commands.run();
  };

  const run = state.stage === "running" ? state.run : undefined;
  const job = run?.mode === "async" ? jobs.find((row) => row.statusUrl === run.jobRef) : undefined;
  const resultJob =
    state.stage === "result" && state.jobRef !== undefined
      ? jobs.find((row) => row.statusUrl === state.jobRef)
      : undefined;

  return (
    <section aria-labelledby={`${base}-heading`}>
      <p className="breadcrumb">
        <button
          type="button"
          className="link"
          onClick={commands.backToList}
          disabled={state.stage === "running"}
        >
          All processes
        </button>
      </p>
      <h2
        id={`${base}-heading`}
        tabIndex={-1}
        data-focus-on-stage={state.stage === "process" ? true : undefined}
      >
        {process.title ?? process.id}
      </h2>
      {process.description !== undefined && <p>{process.description}</p>}
      <About state={state} />

      {process.execution.defaulted && (
        <p className="notice">
          The server did not state how this process can run; assuming synchronous.
        </p>
      )}
      {warnings.length > 0 && (
        <div className="notice">
          <p>The description has problems this client worked around:</p>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>
                <code>{warning}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate aria-labelledby={`${base}-heading`}>
        <fieldset disabled={!editable} className="form-body">
          <legend className="visually-hidden">Inputs</legend>
          {plan.fields.length === 0 && <p>This process takes no inputs.</p>}
          {plan.fields.map((field, index) => (
            <FieldView
              key={field.id}
              field={field}
              index={index}
              values={values}
              error={fieldErrors.get(field.id)}
              warnings={schemaNotes?.get(field.id)}
              onChange={commands.setValue}
            />
          ))}
        </fieldset>

        <OutputChoices
          state={state}
          developer={developer}
          editable={editable}
          onChange={commands.setTransmission}
        />

        {errorCount > 0 && (
          <p className="error-box" role="alert">
            {errorCount === 1 ? "One input needs" : `${String(errorCount)} inputs need`} attention
            before this can run. The messages are next to each one.
          </p>
        )}

        {state.stage === "process" && (
          <div className="run-bar">
            {both && (
              <label className="choice">
                <input
                  type="checkbox"
                  checked={mode === "async"}
                  onChange={(event) => {
                    commands.setMode(event.target.checked ? "async" : "sync");
                  }}
                />{" "}
                Run in the background
              </label>
            )}
            <button type="submit">{onlyAsync ? "Run in the background" : "Run"}</button>
          </div>
        )}
      </form>

      {state.stage === "process" && (
        <ErrorMessage
          error={state.error}
          tone={state.error?.notice === true ? "notice" : "error"}
        />
      )}
      {state.stage === "process" && state.error?.inputId !== undefined && (
        <p className="hint">The server's message names the input “{state.error.inputId}”.</p>
      )}

      {state.stage === "running" && (
        <div
          className="running"
          role="status"
          aria-live="polite"
          data-job-ref={state.run.mode === "async" ? state.run.jobRef : undefined}
          data-doorbells={job?.doorbells}
          data-callbacks={callbacksOf(job)}
        >
          {state.run.mode === "sync" ? (
            <p>Running… waiting for the server's answer.</p>
          ) : (
            <>
              <p>
                <JobStatusLine job={job} />
              </p>
              {state.run.jobRef !== undefined && (
                <p className="actions">
                  <button type="button" className="secondary" onClick={commands.cancelJob}>
                    Cancel job
                  </button>
                  {dismissAdvertisedBy === "nothing" && (
                    <span className="muted">
                      {" "}
                      This server does not advertise that jobs can be cancelled; trying is recorded.
                    </span>
                  )}
                </p>
              )}
            </>
          )}
          {jobNotice !== undefined && <p>{jobNotice}</p>}
        </div>
      )}

      {state.stage === "result" && (
        // The job's markers again, for after it finished: the running view is
        // gone the moment a read finds the job done, which can be within
        // milliseconds of the doorbell that prompted the read.
        <div
          data-result-of={state.jobRef}
          data-doorbells={resultJob?.doorbells}
          data-callbacks={callbacksOf(resultJob)}
        >
          <StatusChanged job={resultJob} />
          <ResultsView
            results={state.results}
            processId={process.id}
            onLoad={commands.loadReference}
          />
          <p className="actions">
            <button type="button" onClick={commands.edit}>
              Change the inputs
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
