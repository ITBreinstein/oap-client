/**
 * "Inputs you sent": while a run is under way and after it, the record of
 * what went into the request, as text, in place of the form. Disabled
 * controls looked clickable; this has nothing to click but the folds that
 * show a long value whole. "Change the inputs" brings the form back, with
 * the same values in it.
 *
 * One row per input that was sent, its label then its value in words
 * (`sent-inputs.ts`); the outputs, where the form offered a choice; then one
 * line for what was left out.
 */

import type { ProcessDescription } from "@breinstein/oap-client";
import type { FormValues } from "../forms/encode.js";
import type { FormPlan } from "../forms/plan.js";
import { toExecuteBody } from "../forms/encode.js";
import { CopyButton } from "./CopyButton.js";
import { notSentLine, outputsLine, summarise, wasSent, type Summary } from "./sent-inputs.js";
import { useUpdated } from "./variant.js";

export interface SentInputsProps {
  /** The id of the heading that names this record. */
  readonly headingId: string;
  readonly plan: FormPlan;
  readonly values: FormValues;
  readonly process: ProcessDescription;
  readonly linkOutputs: readonly string[];
  readonly developer: boolean;
  /** The run has finished. */
  readonly done: boolean;
  /** Whether the map draws a field's value, as the input's dashed outline. */
  readonly onMap: (fieldId: string, value: unknown) => boolean;
}

function Value({ summary }: { readonly summary: Summary }) {
  return (
    <>
      {summary.parts.map((part, index) =>
        part.mono === true ? (
          <span key={index} className="mono">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
      {summary.full !== undefined && (
        <details className="sent-full">
          <summary>Show the value</summary>
          <pre className="code">{summary.full}</pre>
        </details>
      )}
    </>
  );
}

export function SentInputs(props: SentInputsProps) {
  const { headingId, plan, values, process, linkOutputs, developer, done, onMap } = props;
  const valueOf = (id: string) => (Object.hasOwn(values, id) ? values[id] : undefined);
  const sent = plan.fields.filter((field) => wasSent(field, valueOf(field.id)));
  const outputs = outputsLine(process, linkOutputs, developer);
  const notSent = notSentLine(plan, values);
  // STYLE TRIAL: the updated Instrument offers the inputs sent, as JSON, to copy.
  const updated = useUpdated();

  return (
    <section className="sent-inputs" aria-labelledby={headingId} data-testid="sent-inputs">
      <div className="sent-head">
        <h3 id={headingId} className="sent-heading">
          Inputs you sent
        </h3>
        {updated && sent.length > 0 && (
          <CopyButton
            name="Copy inputs"
            text={() => JSON.stringify(toExecuteBody(plan, values).inputs, null, "\t")}
          />
        )}
      </div>
      {sent.length === 0 && outputs === undefined ? (
        <p className="sent-none">
          {plan.fields.length === 0 ? "This process takes no inputs." : "No inputs."}
        </p>
      ) : (
        <dl className="sent-list">
          {sent.map((field) => {
            const value = valueOf(field.id);
            return (
              <div key={field.id} className="sent-row" data-input-id={field.id}>
                <dt>{field.title}</dt>
                <dd>
                  <Value
                    summary={summarise(field, value, { onMap: onMap(field.id, value), done })}
                  />
                </dd>
              </div>
            );
          })}
          {outputs !== undefined && (
            <div className="sent-row" data-sent-outputs="true">
              <dt>Outputs</dt>
              <dd>{outputs}</dd>
            </div>
          )}
        </dl>
      )}
      {notSent !== undefined && <p className="sent-not-sent">{notSent}</p>}
    </section>
  );
}
