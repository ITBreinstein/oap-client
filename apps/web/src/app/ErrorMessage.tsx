/** A workflow error: what happened, and what to do next (T11). Never an apology. */

import { useSpared, withoutRecordNote } from "./developer.js";
import { useUpdated } from "./variant.js";
import type { WorkflowError } from "./workflow.js";

export function ErrorMessage({
  error,
  tone = "error",
}: {
  readonly error: WorkflowError | undefined;
  readonly tone?: "error" | "notice";
}) {
  // STYLE TRIAL: the updated Instrument spares a visitor "The attempt has
  // been recorded." (#43); it is recorded all the same.
  const spared = useSpared(useUpdated());
  if (error === undefined) return null;
  const said = (text: string) => (spared ? withoutRecordNote(text) : text);
  const detail = error.detail === undefined ? undefined : said(error.detail);
  return (
    <div
      className={tone === "error" ? "error-box" : "notice"}
      role={tone === "error" ? "alert" : "status"}
    >
      <p className="error-title">{said(error.title)}</p>
      {detail !== undefined && detail !== "" && <p className="error-detail">{detail}</p>}
    </div>
  );
}
