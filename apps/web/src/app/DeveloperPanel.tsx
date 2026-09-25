/**
 * The developer panel (T4): the session's observations, and a way to take
 * them away as a file. Also the raw asynchronous-execution panel from Task 6,
 * kept as a developer view because the relay's browser tests drive it.
 *
 * Collapsed unless the page was opened with `?developer`, so the demo shows
 * the workflow and not its plumbing.
 */

import { VERSION } from "@breinstein/oap-client";
import { AsyncJobPanel } from "../jobs/AsyncJobPanel.js";
import { observationExport, type WebObservation } from "../observations.js";
import { saveBlob } from "./save.js";

function download(observations: readonly WebObservation[]): void {
  const blob = new Blob([observationExport(observations, VERSION)], { type: "application/json" });
  saveBlob(blob, `oap-client-observations-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

export function DeveloperPanel({
  observations,
  relayUrl,
  open,
}: {
  readonly observations: readonly WebObservation[];
  readonly relayUrl: string | undefined;
  readonly open: boolean;
}) {
  const forms = observations.filter((observation) => observation.kind === "form").length;
  return (
    <details className="developer" open={open}>
      <summary>Developer</summary>
      <p>
        {observations.length} observations this session, {forms} from form generation.
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
      </p>
      <AsyncJobPanel relayUrl={relayUrl} />
    </details>
  );
}
