/**
 * How much one client, and all clients together, may ask of the relay.
 *
 * Nothing here can tell a person from a script: `POST /sessions` needs no
 * credentials, and `allowedOrigins` restrains browsers only. So the limits
 * count per client address (see `client-address.ts`), and per endpoint across
 * every client, and a refused request sends nothing upstream.
 *
 * ## The algorithm: a token bucket per client and route
 *
 * Each bucket holds up to one minute's allowance and refills continuously at
 * that rate. A request takes one token, or is refused with the time until the
 * next one. Chosen over the alternatives because:
 *
 * - A **fixed window** (count per calendar minute) lets a client spend one
 *   minute's allowance at 0:59 and the next at 1:00: double the rate inside two
 *   seconds, at every boundary.
 * - A **sliding log** is exact but keeps one timestamp per request: 240 for a
 *   busy reader, times every client.
 * - A **token bucket** keeps two numbers per bucket. A burst is never larger
 *   than one minute's allowance — a page opening a service reads a handful of
 *   documents at once, which it must be allowed — and the sustained rate is
 *   exactly the limit. Only a client that has been idle for a full minute
 *   starts with a full bucket.
 *
 * ## Memory
 *
 * Bounded by `maxTrackedClients`. A client whose buckets are all full, with
 * nothing in flight and no stream open, is indistinguishable from one never
 * seen, so `sweep()` forgets it. At the bound, the limiter first sweeps; if it
 * is still full, a new client shares one **overflow** entry with every other
 * newcomer until room is made. No client that is being limited is ever evicted
 * to make room: that would hand it a fresh allowance. Newcomers are limited
 * together rather than refused outright or let through unlimited.
 *
 * No timers: time comes from the injected clock, and the relay's minute sweep
 * in `server.ts` reclaims memory and takes the minute's report.
 */

import type { ClientKey } from "./client-address.js";
import type { Clock } from "./state.js";

export interface PerClientLimits {
  readonly sessionsPerMinute: number;
  readonly executesPerMinute: number;
  readonly readsPerMinute: number;
  /** `GET /endpoints` and every CORS preflight. */
  readonly endpointsAndPreflightsPerMinute: number;
  /** Event streams open at once. */
  readonly openStreams: number;
  /** Executes and reads sent upstream and not yet finished, at once. */
  readonly inFlight: number;
}

export interface PerEndpointLimits {
  /** Executes and reads sent to one endpoint, across all clients. */
  readonly requestsPerMinute: number;
  /** Executes and reads in flight to one endpoint at once, across all clients. */
  readonly inFlight: number;
}

export interface RateLimits {
  readonly perClient: PerClientLimits;
  readonly perEndpoint: PerEndpointLimits;
  readonly maxTrackedClients: number;
}

/** The production values. Raised for an event in the config, never switched off. */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  perClient: {
    sessionsPerMinute: 10,
    executesPerMinute: 20,
    readsPerMinute: 240,
    endpointsAndPreflightsPerMinute: 120,
    openStreams: 4,
    inFlight: 6,
  },
  perEndpoint: { requestsPerMinute: 600, inFlight: 32 },
  maxTrackedClients: 50_000,
};

/** The routes with a per-minute budget per client. */
export type RateRoute = "sessions" | "execute" | "read" | "endpoints-and-preflights";

const PER_MINUTE: Readonly<Record<RateRoute, keyof PerClientLimits>> = {
  sessions: "sessionsPerMinute",
  execute: "executesPerMinute",
  read: "readsPerMinute",
  "endpoints-and-preflights": "endpointsAndPreflightsPerMinute",
};

export type RateLimitCode = "rate-limited" | "rate-limited-endpoint";

export interface Refused {
  readonly ok: false;
  readonly code: RateLimitCode;
  /** Whole seconds, at least 1. */
  readonly retryAfterSeconds: number;
}

export interface Admitted {
  readonly ok: true;
  /** Gives back a concurrent slot. Safe to call more than once, and to pass around. */
  readonly release: () => void;
}

/** What the relay logs once a minute, and only when there is something to say. */
export interface MinuteReport {
  /** Refusals by limit: a route, `streams`, `in-flight`, or `endpoint:<key>`. */
  readonly rateLimit: Readonly<Record<string, number>>;
  /** Requests from a trusted proxy that named no readable client. */
  readonly unknownBucket: number;
  /** Requests from newcomers while the limiter was at `maxTrackedClients`. */
  readonly overflowBucket: number;
  readonly trackedKeys: number;
}

const MINUTE_MS = 60_000;

/** A concurrency refusal has no refill time to report: a slot frees when a request ends. */
const CONCURRENCY_RETRY_SECONDS = 1;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

interface ClientEntry {
  readonly buckets: Map<RateRoute, Bucket>;
  inFlight: number;
  streams: number;
}

interface EndpointEntry {
  readonly bucket: Bucket;
  inFlight: number;
}

const newEntry = (): ClientEntry => ({ buckets: new Map(), inFlight: 0, streams: 0 });

/** The bucket's tokens at `now`, refilled since it was last touched. */
function refill(bucket: Bucket, perMinute: number, now: number): number {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  return Math.min(perMinute, bucket.tokens + (elapsed * perMinute) / MINUTE_MS);
}

/** Seconds until a bucket holding `tokens` has one whole token. */
function secondsUntilToken(tokens: number, perMinute: number): number {
  return Math.max(1, Math.ceil(((1 - tokens) * MINUTE_MS) / perMinute / 1000));
}

export class RateLimiter {
  readonly #clock: Clock;
  readonly #limits: RateLimits;
  readonly #clients = new Map<string, ClientEntry>();
  readonly #overflow = newEntry();
  readonly #endpoints = new Map<string, EndpointEntry>();
  readonly #refusals = new Map<string, number>();
  #unknownRequests = 0;
  #overflowRequests = 0;

  constructor(clock: Clock, limits: RateLimits = DEFAULT_RATE_LIMITS) {
    this.#clock = clock;
    this.#limits = limits;
  }

  /**
   * One request on a route with a per-minute budget. Every limited request
   * passes here exactly once, so this is also where the unknown and overflow
   * buckets are counted.
   */
  take(route: RateRoute, client: ClientKey): Admitted | Refused {
    if (client.unknown) this.#unknownRequests += 1;
    const entry = this.#entry(client.key);
    if (entry === this.#overflow) this.#overflowRequests += 1;
    const perMinute = this.#limits.perClient[PER_MINUTE[route]];
    const now = this.#clock.now();
    let bucket = entry.buckets.get(route);
    if (bucket === undefined) {
      bucket = { tokens: perMinute, updatedAt: now };
      entry.buckets.set(route, bucket);
    }
    const tokens = refill(bucket, perMinute, now);
    bucket.updatedAt = now;
    if (tokens < 1) {
      bucket.tokens = tokens;
      return this.#refuse(route, "rate-limited", secondsUntilToken(tokens, perMinute));
    }
    bucket.tokens = tokens - 1;
    return { ok: true, release: () => undefined };
  }

  /** One event stream. Released when the stream closes. */
  openStream(client: ClientKey): Admitted | Refused {
    const entry = this.#entry(client.key);
    if (entry.streams >= this.#limits.perClient.openStreams) {
      return this.#refuse("streams", "rate-limited", CONCURRENCY_RETRY_SECONDS);
    }
    entry.streams += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        entry.streams -= 1;
      },
    };
  }

  /**
   * One request about to be sent upstream to `endpointKey`, a configured key.
   * Checks the client's slots, the endpoint's minute and the endpoint's slots,
   * and takes nothing unless all three allow it. Release when the response body
   * is finished or broken off, not when its headers arrive.
   */
  beginForward(client: ClientKey, endpointKey: string): Admitted | Refused {
    const entry = this.#entry(client.key);
    const { perEndpoint } = this.#limits;
    if (entry.inFlight >= this.#limits.perClient.inFlight) {
      return this.#refuse("in-flight", "rate-limited", CONCURRENCY_RETRY_SECONDS);
    }
    const now = this.#clock.now();
    let endpoint = this.#endpoints.get(endpointKey);
    if (endpoint === undefined) {
      endpoint = { bucket: { tokens: perEndpoint.requestsPerMinute, updatedAt: now }, inFlight: 0 };
      this.#endpoints.set(endpointKey, endpoint);
    }
    const tokens = refill(endpoint.bucket, perEndpoint.requestsPerMinute, now);
    endpoint.bucket.tokens = tokens;
    endpoint.bucket.updatedAt = now;
    if (tokens < 1) {
      return this.#refuse(
        `endpoint:${endpointKey}`,
        "rate-limited-endpoint",
        secondsUntilToken(tokens, perEndpoint.requestsPerMinute),
      );
    }
    if (endpoint.inFlight >= perEndpoint.inFlight) {
      return this.#refuse(
        `endpoint:${endpointKey}`,
        "rate-limited-endpoint",
        CONCURRENCY_RETRY_SECONDS,
      );
    }
    endpoint.bucket.tokens = tokens - 1;
    endpoint.inFlight += 1;
    entry.inFlight += 1;
    const held = endpoint;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        held.inFlight -= 1;
        entry.inFlight -= 1;
      },
    };
  }

  /** Forget clients that are back where they started. Returns how many. */
  sweep(): number {
    const now = this.#clock.now();
    let forgotten = 0;
    for (const [key, entry] of this.#clients) {
      if (this.#isIdle(entry, now)) {
        this.#clients.delete(key);
        forgotten += 1;
      }
    }
    return forgotten;
  }

  /** The minute's report, then a fresh count. `undefined` when there is nothing to report. */
  report(): MinuteReport | undefined {
    const report: MinuteReport = {
      rateLimit: Object.fromEntries([...this.#refusals].sort(([a], [b]) => a.localeCompare(b))),
      unknownBucket: this.#unknownRequests,
      overflowBucket: this.#overflowRequests,
      trackedKeys: this.#clients.size,
    };
    this.#refusals.clear();
    this.#unknownRequests = 0;
    this.#overflowRequests = 0;
    const quiet =
      Object.keys(report.rateLimit).length === 0 &&
      report.unknownBucket === 0 &&
      report.overflowBucket === 0;
    return quiet ? undefined : report;
  }

  /** Sizes only, for tests. */
  counts(): { trackedKeys: number } {
    return { trackedKeys: this.#clients.size };
  }

  #entry(key: string): ClientEntry {
    const known = this.#clients.get(key);
    if (known !== undefined) return known;
    if (this.#clients.size >= this.#limits.maxTrackedClients) {
      this.sweep();
      if (this.#clients.size >= this.#limits.maxTrackedClients) return this.#overflow;
    }
    const entry = newEntry();
    this.#clients.set(key, entry);
    return entry;
  }

  #isIdle(entry: ClientEntry, now: number): boolean {
    if (entry.inFlight > 0 || entry.streams > 0) return false;
    for (const [route, bucket] of entry.buckets) {
      const perMinute = this.#limits.perClient[PER_MINUTE[route]];
      if (refill(bucket, perMinute, now) < perMinute) return false;
    }
    return true;
  }

  #refuse(label: string, code: RateLimitCode, retryAfterSeconds: number): Refused {
    this.#refusals.set(label, (this.#refusals.get(label) ?? 0) + 1);
    return { ok: false, code, retryAfterSeconds };
  }
}
