/**
 * Keeping the lane's pygeoapi job stores small (reliability task, 2026-10-26).
 *
 * pygeoapi 0.21.0 keeps every job in one TinyDB file. Each job read or write
 * takes a lock shared by all four request workers, then opens and parses the
 * whole file, so every job request gets slower as the store grows, and under
 * load they queue: a job status read took 2–8 s in step zero, with 822 jobs
 * stored, while a process description took milliseconds. Every lane run adds
 * about 80 jobs, and nothing but recreating the container removes them, so a
 * laptop's lane slows down over a day in a way CI, which starts empty, never
 * does.
 *
 * Before the blocking and PDOK lanes (`job-store.setup.ts`, a setup project
 * they depend on), a store above {@link JOB_STORE_THRESHOLD} jobs has its
 * finished jobs dismissed (`DELETE /jobs/{id}`, the standard's own way),
 * oldest first. Only the lane's own servers, `:5080` and `:5081`; only jobs
 * whose status is final (`successful`, `failed`, `dismissed`); and only those
 * that finished more than {@link FINISHED_AGE_MS} ago, so a lane running
 * beside another never removes a job the other has only just finished and is
 * about to read. What was done, and how long it took, is printed.
 */

export const JOB_STORE_THRESHOLD = 300;
export const FINISHED_AGE_MS = 15 * 60_000;
/** Over this, recreating the container is the cheaper way to empty it. */
export const SLOW_CLEANUP_MS = 30_000;

const FINAL: ReadonlySet<string> = new Set(["successful", "failed", "dismissed"]);
/** The most pages walked: 100 000 jobs at fifty a page. */
const MAX_PAGES = 2_000;

interface ListedJob {
  readonly id: string;
  readonly status: string;
  /** Milliseconds since the epoch; undefined when the job has not finished. */
  readonly finished: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jobsOf(page: unknown): ListedJob[] {
  const jobs = isRecord(page) ? page["jobs"] : undefined;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((job: unknown) => {
    if (!isRecord(job)) return [];
    const id = job["jobID"];
    const status = job["status"];
    const finished = job["finished"];
    if (typeof id !== "string" || typeof status !== "string") return [];
    const at = typeof finished === "string" ? Date.parse(finished) : Number.NaN;
    return [{ id, status, finished: Number.isNaN(at) ? undefined : at }];
  });
}

function nextOf(page: unknown): string | undefined {
  const links = isRecord(page) ? page["links"] : undefined;
  if (!Array.isArray(links)) return undefined;
  for (const link of links as unknown[]) {
    if (isRecord(link) && link["rel"] === "next" && typeof link["href"] === "string") {
      return link["href"];
    }
  }
  return undefined;
}

/** Every job the server lists, following `next` as served. */
async function listAll(base: string): Promise<ListedJob[]> {
  const all: ListedJob[] = [];
  let url: string | undefined = `${base}/jobs?f=json&limit=50`;
  for (let pages = 0; url !== undefined && pages < MAX_PAGES; pages += 1) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`GET ${url} answered ${String(response.status)}`);
    const page: unknown = await response.json();
    all.push(...jobsOf(page));
    url = nextOf(page);
  }
  return all;
}

export interface Pruned {
  readonly held: number;
  readonly dismissed: number;
  readonly ms: number;
}

/** Dismiss the old finished jobs on `base` when it holds more than `threshold`. */
export async function pruneFinishedJobs(
  base: string,
  options: { readonly threshold?: number; readonly olderThanMs?: number } = {},
): Promise<Pruned> {
  const threshold = options.threshold ?? JOB_STORE_THRESHOLD;
  const olderThanMs = options.olderThanMs ?? FINISHED_AGE_MS;
  const started = Date.now();
  const jobs = await listAll(base);
  if (jobs.length <= threshold)
    return { held: jobs.length, dismissed: 0, ms: Date.now() - started };
  const before = started - olderThanMs;
  const old = jobs
    .filter((job) => FINAL.has(job.status) && job.finished !== undefined && job.finished < before)
    .sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0));
  let dismissed = 0;
  // One at a time: the server serialises them on its one lock anyway.
  for (const job of old) {
    const response = await fetch(`${base}/jobs/${encodeURIComponent(job.id)}`, {
      method: "DELETE",
    });
    await response.arrayBuffer();
    if (response.ok) dismissed += 1;
  }
  return { held: jobs.length, dismissed, ms: Date.now() - started };
}

/** One line for the run's output: what was found, what was done, how long it took. */
export function prunedLine(name: string, pruned: Pruned): string {
  const seconds = (pruned.ms / 1000).toFixed(1);
  if (pruned.dismissed === 0 && pruned.held <= JOB_STORE_THRESHOLD) {
    return `${name} holds ${String(pruned.held)} jobs: under ${String(JOB_STORE_THRESHOLD)}, nothing dismissed (${seconds} s).`;
  }
  const line = `${name} held ${String(pruned.held)} jobs, over ${String(JOB_STORE_THRESHOLD)}: dismissed ${String(pruned.dismissed)} finished more than ${String(FINISHED_AGE_MS / 60_000)} min ago, in ${seconds} s.`;
  return pruned.ms > SLOW_CLEANUP_MS
    ? `${line} That is over ${String(SLOW_CLEANUP_MS / 1000)} s: recreating the container empties it faster (docker compose -f infra/compose/pygeoapi.yml up -d --force-recreate --wait).`
    : line;
}
