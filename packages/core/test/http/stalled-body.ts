/**
 * A server or proxy that sends its headers and then stalls, for the tests of
 * what a deadline or a caller's abort does to a body still being read.
 */

/**
 * Headers at once, then a body that never sends a byte. When the request's
 * signal fires, the body stream errors with the signal's reason, as fetch does
 * for an abort that arrives after the headers (Fetch, "abort fetch": "If
 * response's body is non-null and is readable, then error response's body").
 * Node's undici does the same.
 */
export function stalledBody(
  signal: AbortSignal | null | undefined,
  contentType = "application/json",
  status = 200,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        "abort",
        () => {
          controller.error(signal.reason ?? new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    },
  });
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

/** A `fetch` that answers every request with {@link stalledBody}. */
export function stallingFetch(
  contentType?: string,
  status?: number,
): (url: string, init?: RequestInit) => Promise<Response> {
  return (_url: string, init: RequestInit = {}): Promise<Response> =>
    Promise.resolve(stalledBody(init.signal, contentType, status));
}

export const HUNG: unique symbol = Symbol("hung");

/** The promise's outcome — its value or its error — or {@link HUNG} if it has not settled within `ms`. */
export async function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof HUNG | Error> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<typeof HUNG>((resolve) => {
    timer = setTimeout(() => {
      resolve(HUNG);
    }, ms);
  });
  try {
    return await Promise.race([promise.catch((error: unknown) => error as Error), hung]);
  } finally {
    clearTimeout(timer);
  }
}

/** An AbortController that aborts on its own after `ms`. */
export function abortAfter(ms: number, reason?: unknown): AbortController {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(reason);
  }, ms);
  return controller;
}
