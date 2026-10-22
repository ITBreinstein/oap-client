/**
 * Which jobs the rail's Jobs badge counts (#30): those still under way. A
 * job the server called successful is done, even while this page reads it
 * once more to confirm it (finding 0047): nothing is asked of the visitor.
 */

import type { JobRow } from "../relay/job-session.js";

/** Whether a job is still under way: no status read yet, or one not final. */
export function isUnderWay(job: JobRow): boolean {
  return !job.gone && (job.status === undefined || !job.status.terminal);
}
