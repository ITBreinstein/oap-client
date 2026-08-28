/**
 * Turning parsed conformance classes into something a UI can act on — honestly.
 *
 * The honesty problem is specific and worth stating plainly. In Part 1 v1.0,
 * `dismiss` and `callback` are their own conformance classes, but **synchronous
 * and asynchronous execution are not** — both live inside Core. There is no URI
 * a server can send that means "I honour `Prefer: respond-async`". The standard
 * says a Core-conformant server does. Reality is under no obligation to agree.
 *
 * So `sync` and `async` here are assumptions derived from Core, and the type
 * says so. The interoperability matrix column for async must record what
 * happened when we tried it, never what this field claimed.
 */

import type { ParsedConformance } from "./parse.js";

/** The specification family these capabilities are read from. */
const PROCESSES_FAMILY = "ogcapi-processes";
const PROCESSES_PART = 1;

export interface ServiceCapabilities {
  /**
   * Synchronous execution.
   *
   * **Assumed, not advertised.** Derived optimistically from the Core
   * conformance class, which is the only thing that implies it.
   */
  readonly sync: boolean;
  /**
   * Asynchronous execution via `Prefer: respond-async`.
   *
   * **Assumed, not advertised.** Derived optimistically from Core. No
   * conformance class covers it, so this must be *probed* before it is
   * believed, and the probe's result is what belongs in a findings report.
   */
  readonly async: boolean;
  /**
   * Job dismissal via `DELETE /jobs/{id}`.
   *
   * **Advertised** by its own conformance class — when the server declares it.
   * A `false` here means "not declared", which is not the same as "not
   * supported": pygeoapi 0.21 answers `DELETE` with a 200 while declaring no
   * dismiss class at all.
   */
  readonly dismiss: boolean;
  /**
   * Execution callbacks.
   *
   * **Advertised** by its own conformance class.
   */
  readonly callback: boolean;
  /** Every URI as received, including ones we could not parse. */
  readonly rawConformance: readonly string[];
}

/** Version-agnostic: a v2 draft's `conf/core` is still `core`. */
function declares(parsed: ParsedConformance, name: string): boolean {
  return parsed.classes.some(
    (klass) =>
      klass.family === PROCESSES_FAMILY && klass.part === PROCESSES_PART && klass.name === name,
  );
}

/**
 * Derive capabilities from parsed conformance.
 *
 * **Never throws, and never gates.** A missing conformance class greys out a
 * button; it must not stop the core issuing the request. Servers under-advertise
 * in the wild — "supports dismiss but does not declare it" is itself one of the
 * findings this project exists to collect — and a client that refuses to try
 * would never discover it.
 */
export function deriveCapabilities(parsed: ParsedConformance): ServiceCapabilities {
  const core = declares(parsed, "core");

  return {
    sync: core,
    async: core,
    dismiss: declares(parsed, "dismiss"),
    callback: declares(parsed, "callback"),
    rawConformance: parsed.raw,
  };
}

/**
 * What we report for a service whose conformance document was missing, broken
 * or unreadable: everything `false`, nothing claimed.
 *
 * Degraded, not dead. The caller can still list processes — and a UI that greys
 * out every optional button is a far better outcome than discovery throwing.
 */
export function unknownCapabilities(): ServiceCapabilities {
  return {
    sync: false,
    async: false,
    dismiss: false,
    callback: false,
    rawConformance: Object.freeze([]),
  };
}
