/** A workflow error: what happened, and what to do next (T11). Never an apology. */

import type { WorkflowError } from "./workflow.js";

export function ErrorMessage({
  error,
  tone = "error",
}: {
  readonly error: WorkflowError | undefined;
  readonly tone?: "error" | "notice";
}) {
  if (error === undefined) return null;
  return (
    <div
      className={tone === "error" ? "error-box" : "notice"}
      role={tone === "error" ? "alert" : "status"}
    >
      <p className="error-title">{error.title}</p>
      {error.detail !== undefined && <p className="error-detail">{error.detail}</p>}
    </div>
  );
}
