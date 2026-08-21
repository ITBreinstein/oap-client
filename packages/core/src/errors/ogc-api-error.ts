/** RFC 7807 problem details, as returned by OGC API - Processes servers. */
export interface ProblemDetails {
  readonly type: string;
  readonly title?: string | undefined;
  readonly status?: number | undefined;
  readonly detail?: string | undefined;
  readonly instance?: string | undefined;
}

/** An error carrying the server's problem document, when it sent one. */
export class OgcApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | undefined;

  constructor(message: string, status: number, problem?: ProblemDetails) {
    super(message);
    this.name = "OgcApiError";
    this.status = status;
    this.problem = problem;
  }
}
