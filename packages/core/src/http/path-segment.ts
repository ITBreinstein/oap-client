/**
 * One server-chosen id as one path segment.
 *
 * `encodeURIComponent` leaves `.` alone, so an id of `.` or `..` would survive
 * it and then be resolved as a dot segment — `..` turning a job URL into its
 * parent, and a request for one job into a request for the job list. Encoding
 * does not help: the WHATWG URL parser treats `%2e` as a dot too. No URL can
 * name such a resource, so it is refused here rather than sent somewhere else.
 */
export function encodePathSegment(id: string): string {
  if (id === "." || id === "..") {
    throw new TypeError(`the id "${id}" cannot be sent as a URL path segment`);
  }
  return encodeURIComponent(id);
}
