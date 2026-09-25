/** A caller's signal and a deadline, as one signal that remembers which fired. */

/**
 * One signal that fires for either reason, and remembers which.
 *
 * `AbortSignal.any` would do most of this, but it is Node 20+ and this package
 * supports Node 18, and it would also lose the part that matters: *which* of
 * the two fired. "The user cancelled" and "the server never answered" are
 * different facts about a service, and a matrix that cannot tell them apart
 * cannot say whether synchronous execution is viable for real work. See T8.
 *
 * Used by `execute()` for its one POST, and by `pollJob()` so that its total
 * deadline also ends a status read that never answers.
 */
export function withDeadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = (): void => {
    controller.abort(signal?.reason);
  };

  if (signal !== undefined) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}
