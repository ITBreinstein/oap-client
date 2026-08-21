/**
 * The subset of WHATWG `fetch` the core relies on. Injecting it is what keeps
 * the package runtime-neutral: Node 18+, browsers, workers and test doubles all
 * satisfy it without the core naming any of them.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Falls back to the ambient `fetch`, which Node 18+ and browsers both provide. */
export function resolveFetch(injected?: FetchLike): FetchLike {
  if (injected) return injected;

  const ambient: unknown = globalThis.fetch;
  if (typeof ambient !== "function") {
    throw new TypeError(
      "No fetch available. Pass one via `createClient({ fetch })` on runtimes without a global fetch.",
    );
  }
  return globalThis.fetch.bind(globalThis);
}
