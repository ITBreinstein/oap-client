import {
  type Execution,
  type ObservationSink,
  type ProcessDescription,
  buildRequest,
  execute,
} from "@breinstein/oap-client";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { type Failure, describeFailure } from "../results/describe-failure.js";
import { ResultPanel } from "../results/ResultPanel.js";
import { DEFAULT_RUN_SETTINGS, buildExecutePlan } from "./build-execute-options.js";

export interface RunButtonProps {
  readonly processesUrl: string;
  readonly description: ProcessDescription;
  readonly values: Readonly<Record<string, unknown>>;
  readonly onObservation?: ObservationSink;
}

type RunState =
  | { readonly phase: "idle" }
  | { readonly phase: "running" }
  | { readonly phase: "done"; readonly execution: Execution }
  | { readonly phase: "failed"; readonly failure: Failure };

/**
 * Runs the process, and shows what would be sent before it is.
 *
 * `execute` lives here rather than in `App` so that run state cannot outlive the
 * form it belongs to: switching process unmounts this, which aborts the request.
 */
export function RunButton({
  processesUrl,
  description,
  values,
  onObservation,
}: RunButtonProps): ReactElement {
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const running = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  // Pure and cheap, so the warnings and the preview are always current.
  const plan = buildExecutePlan(description, values, DEFAULT_RUN_SETTINGS);
  const preview = buildRequest(processesUrl, description.id, plan.options);

  const run = (): void => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setState({ phase: "running" });

    execute(processesUrl, description.id, {
      ...plan.options,
      signal: controller.signal,
      ...(onObservation === undefined ? {} : { onObservation }),
    })
      .then((execution) => {
        if (!controller.signal.aborted) setState({ phase: "done", execution });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: "failed", failure: describeFailure(cause) });
      });
  };

  return (
    <section>
      <p>
        <button type="button" onClick={run} disabled={state.phase === "running"}>
          {state.phase === "running" ? "Running…" : "Run"}
        </button>{" "}
        <span>{DEFAULT_RUN_SETTINGS.mode} execution</span>
      </p>

      {/* Advisory, never blocking. ZOO omits `minOccurs`, which the
          specification defaults to 1, so "missing required input" appears on
          requests that work perfectly — and sending anyway is how an
          under-declared description gets found at all. */}
      {plan.warnings.length > 0 && (
        <ul data-testid="run-warnings">
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <details>
        <summary>Request that would be sent</summary>
        <p>
          {preview.route === "advertised-link"
            ? "To the execute link the description advertises."
            : "To a path built from the process id: the description advertises no execute link."}
        </p>
        <pre data-testid="request-preview">{preview.url}</pre>
        <pre>{preview.body}</pre>
      </details>

      {state.phase === "failed" && (
        <div data-testid="run-error">
          <p>{state.failure.summary}</p>
          {state.failure.detail !== undefined && <p>{state.failure.detail}</p>}
          {state.failure.hint !== undefined && <p>{state.failure.hint}</p>}
        </div>
      )}
      {state.phase === "done" && <ResultPanel execution={state.execution} />}
    </section>
  );
}
