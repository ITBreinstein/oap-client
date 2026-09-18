/**
 * Turning what a caller has into a URL a job operation can use.
 *
 * Callers hold three different things and all three have to work:
 *
 * - an absolute status URL, off a {@link JobHandle};
 * - a bare job id, which is all a browser has when it recovered the job from
 *   the job list rather than from a `Location` header it could not read (T8);
 * - a job document's own `results` link, for the results route.
 *
 * The trailing-slash handling is the same rule as `processUrlFor()` and
 * `executionUrlFor()`, and it exists for the same live reason: a job URL
 * reached through the `?f=json` fallback ends in a query, and `new URL()`
 * resolves a relative reference against the *path*, so appending to a URL that
 * still carries its query lands the guess one level too high.
 */

/** An absolute http(s) URL, as opposed to a bare job id. */
export function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * `base` with its query and fragment dropped and its path ensured to end in a
 * slash, so a relative reference resolves *under* it rather than beside it.
 */
function asDirectory(base: string): URL {
  const url = new URL(base);
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  url.search = "";
  url.hash = "";
  return url;
}

/**
 * The status URL for one job, given the service's job-list URL and an id.
 *
 * Used only when the caller supplied a bare id; a caller holding a
 * {@link JobHandle} already has the absolute URL the server itself gave out.
 */
export function jobUrlFor(jobsUrl: string, jobId: string): string {
  return new URL(encodeURIComponent(jobId), asDirectory(jobsUrl)).toString();
}

/**
 * Resolve `./jobs` against the landing-page URL.
 *
 * Only reached when the landing page advertises no `job-list` link, which
 * neither reference server needs — both advertise it, as the long OGC URI —
 * or when discovery itself failed.
 */
export function jobsFallback(landingUrl: string): string {
  return new URL("jobs", asDirectory(landingUrl)).toString();
}

/**
 * Where a job's results live, when the job document did not say.
 *
 * The constructed fallback, `{statusUrl}/results`. Preferring the advertised
 * `results` link is `get-results.ts`'s job; this is what it falls back to, and
 * the route taken is recorded either way.
 */
export function resultsUrlFor(statusUrl: string): string {
  return new URL("results", asDirectory(statusUrl)).toString();
}
