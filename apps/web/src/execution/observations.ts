import type { Observation, ObservationSink } from "@breinstein/oap-client";

export interface ObservationLog {
  readonly sink: ObservationSink;
  /** Mutated in place, oldest first. */
  readonly observations: Observation[];
}

/**
 * Collects what the client saw.
 *
 * These are a deliverable rather than logging: the interoperability matrix this
 * project produces is built from them, and the core redacts URLs and omits both
 * input values and response bodies at the point of creation so they can be
 * published.
 *
 * The array is mutated rather than replaced because the sink is captured inside
 * a promise chain — a fresh array per render would be appended to after the
 * render that owned it had gone.
 */
export function createObservationLog(): ObservationLog {
  const observations: Observation[] = [];
  return {
    sink: (observation) => observations.push(observation),
    observations,
  };
}
