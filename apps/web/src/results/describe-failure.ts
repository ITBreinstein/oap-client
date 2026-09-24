import { ExecutionTimeoutError, ProcessesError, TransportError } from "@breinstein/oap-client";

export interface Failure {
  readonly summary: string;
  /** The server's own words, where it gave any. */
  readonly detail?: string;
  readonly hint?: string;
}

export function describeFailure(cause: unknown): Failure {
  if (cause instanceof ProcessesError) {
    const problem = cause.problem;
    // ZOO fills RFC 7807's `detail`; pygeoapi adds a non-standard `description`.
    const description = problem?.extensions["description"];

    const detail =
      problem?.detail ??
      (typeof description === "string" ? description : undefined) ??
      problem?.title ??
      cause.bodyPreview;

    return {
      summary: `The server refused the request with ${String(cause.status)}.`,
      ...(detail === undefined ? {} : { detail }),
    };
  }

  if (cause instanceof ExecutionTimeoutError) {
    return {
      summary: "The server did not answer in time.",
      hint: "A process this slow is usually meant to be run asynchronously.",
    };
  }

  if (cause instanceof TransportError) {
    // A browser reports a blocked cross-origin request as an opaque failure and
    // puts the reason in the console only.
    return {
      summary: "The request never reached a response.",
      ...(cause.crossOrigin === true
        ? {
            hint:
              "This server is on another origin and may not be sending the CORS headers a " +
              "browser needs. One that answers curl but not the page is a finding.",
          }
        : {}),
    };
  }

  return { summary: cause instanceof Error ? cause.message : String(cause) };
}
