/**
 * What the relay's two outbound requests share — the asynchronous execute
 * (`upstream.ts`) and the read route (`forward.ts`): why an exchange failed,
 * and the timer its deadline runs on.
 *
 * Imports nothing of the relay's own, so either request may use the other's
 * parts without the two importing each other.
 */

/**
 * Why the exchange produced no usable response. Codes, not messages: they go
 * back to the browser, and a message could carry an address or a hostname the
 * browser has no business learning.
 */
export type UpstreamFailure =
  | "blocked-address"
  | "timeout"
  | "redirect-refused"
  /** Read route: more redirects under `baseUrl` than it follows. */
  | "redirect-limit"
  | "response-too-large"
  | "connection-failed"
  /**
   * A status line outside 200–599, on an answer passed back raw. Node's client
   * accepts any three digits; a browser cannot be handed one of those (review
   * R9).
   */
  | "bad-upstream-status";

export class UpstreamError extends Error {
  readonly reason: UpstreamFailure;

  constructor(reason: UpstreamFailure, options?: ErrorOptions) {
    super(`upstream exchange failed: ${reason}`, options);
    this.name = "UpstreamError";
    this.reason = reason;
  }
}

/** Run `callback` after `ms`; the returned function cancels it. */
export type Schedule = (callback: () => void, ms: number) => () => void;

export const systemSchedule: Schedule = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => {
    clearTimeout(handle);
  };
};
