/**
 * Everything the relay remembers, in memory, and nothing it would miss.
 *
 * No database and no queue, on purpose. Polling is authoritative: the browser
 * reads every job's status from the OGC server itself, and a doorbell only
 * makes it read sooner. So losing this state — a restart, a crash, a sweep —
 * costs latency and nothing else. That holds for the relay's *state*. It does
 * not hold for its *availability*: pygeoapi damages a job whose callback it
 * cannot deliver (finding 0047), which is why a callback for a token this
 * state has forgotten is answered, not refused. See `app.ts`.
 *
 * Expiry is checked on every lookup against the injected clock, and `sweep()`
 * only reclaims memory. Nothing here reads the wall clock or starts a timer,
 * so tests step time by hand.
 */

import { mintRef, mintSecretToken } from "./tokens.js";

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Told that something happened to the job behind `ref`. Never told what. */
export type DoorbellListener = (ref: string) => void;

export interface Registration {
  readonly ref: string;
  readonly callbackToken: string;
  readonly sessionToken: string;
  readonly endpointKey: string;
  readonly expiresAt: number;
}

interface Session {
  readonly token: string;
  lastSeen: number;
  readonly listeners: Set<DoorbellListener>;
  readonly refs: Set<string>;
}

export interface StateOptions {
  readonly registrationTtlMs: number;
  readonly sessionIdleTtlMs: number;
  readonly maxSessions: number;
  readonly maxRegistrationsPerSession: number;
}

/**
 * `unknown` covers never-issued, expired and swept alike. The caller answers
 * all three the same way, so they are not distinguished here either.
 */
export type RingOutcome = "delivered" | "no-listener" | "unknown";

export class RelayState {
  readonly #clock: Clock;
  readonly #options: StateOptions;
  readonly #sessions = new Map<string, Session>();
  readonly #byCallbackToken = new Map<string, Registration>();
  readonly #byRef = new Map<string, Registration>();

  constructor(clock: Clock, options: StateOptions) {
    this.#clock = clock;
    this.#options = options;
  }

  /** A new session, or `undefined` when the relay is at its session cap. */
  createSession(): { token: string; expiresAt: number } | undefined {
    if (this.#sessions.size >= this.#options.maxSessions) {
      this.sweep();
      if (this.#sessions.size >= this.#options.maxSessions) return undefined;
    }
    const now = this.#clock.now();
    const token = mintSecretToken();
    this.#sessions.set(token, { token, lastSeen: now, listeners: new Set(), refs: new Set() });
    return { token, expiresAt: now + this.#options.sessionIdleTtlMs };
  }

  /** True, and the idle timer reset, when `token` names a live session. */
  touchSession(token: string): boolean {
    const session = this.#liveSession(token);
    if (session === undefined) return false;
    session.lastSeen = this.#clock.now();
    return true;
  }

  /**
   * Subscribe to a session's doorbells. Returns the unsubscribe function, or
   * `undefined` when the session is unknown or expired — which the browser
   * reads as "open a new session", not as an error.
   */
  listen(token: string, listener: DoorbellListener): (() => void) | undefined {
    const session = this.#liveSession(token);
    if (session === undefined) return undefined;
    session.lastSeen = this.#clock.now();
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
      // Idle time counts from the moment the last stream closed, not from
      // when it opened.
      session.lastSeen = this.#clock.now();
    };
  }

  register(
    sessionToken: string,
    endpointKey: string,
  ): Registration | "unknown-session" | "at-capacity" {
    const session = this.#liveSession(sessionToken);
    if (session === undefined) return "unknown-session";
    this.#dropExpiredRegistrations(session);
    if (session.refs.size >= this.#options.maxRegistrationsPerSession) return "at-capacity";

    const registration: Registration = {
      ref: mintRef(),
      callbackToken: mintSecretToken(),
      sessionToken,
      endpointKey,
      expiresAt: this.#clock.now() + this.#options.registrationTtlMs,
    };
    this.#byCallbackToken.set(registration.callbackToken, registration);
    this.#byRef.set(registration.ref, registration);
    session.refs.add(registration.ref);
    session.lastSeen = this.#clock.now();
    return registration;
  }

  /** Forget a registration — used when the execute it was minted for failed. */
  release(ref: string): void {
    const registration = this.#byRef.get(ref);
    if (registration !== undefined) this.#forget(registration);
  }

  /**
   * A callback arrived for `callbackToken`. Rings every open stream of the
   * owning session with the registration's ref, and nothing else: which of the
   * three URIs was called, and anything in the request, stay here.
   */
  ring(callbackToken: string): RingOutcome {
    const registration = this.#byCallbackToken.get(callbackToken);
    if (registration === undefined) return "unknown";
    if (registration.expiresAt <= this.#clock.now()) {
      this.#forget(registration);
      return "unknown";
    }
    const session = this.#liveSession(registration.sessionToken);
    if (session === undefined) return "unknown";
    if (session.listeners.size === 0) return "no-listener";
    for (const listener of session.listeners) listener(registration.ref);
    return "delivered";
  }

  /** Reclaim memory held by expired sessions and registrations. */
  sweep(): { sessions: number; registrations: number } {
    const now = this.#clock.now();
    let sessions = 0;
    let registrations = 0;
    for (const session of [...this.#sessions.values()]) {
      if (this.#isExpired(session, now)) {
        registrations += session.refs.size;
        this.#dropSession(session);
        sessions += 1;
      }
    }
    for (const registration of [...this.#byRef.values()]) {
      if (registration.expiresAt <= now) {
        this.#forget(registration);
        registrations += 1;
      }
    }
    return { sessions, registrations };
  }

  /** Sizes only, for the health endpoint and for tests. Never a token. */
  counts(): { sessions: number; registrations: number; listeners: number } {
    let listeners = 0;
    for (const session of this.#sessions.values()) listeners += session.listeners.size;
    return { sessions: this.#sessions.size, registrations: this.#byRef.size, listeners };
  }

  #isExpired(session: Session, now: number): boolean {
    // A session with an open stream is in use, however long ago it was made.
    return session.listeners.size === 0 && session.lastSeen + this.#options.sessionIdleTtlMs <= now;
  }

  #liveSession(token: string): Session | undefined {
    const session = this.#sessions.get(token);
    if (session === undefined) return undefined;
    if (this.#isExpired(session, this.#clock.now())) {
      this.#dropSession(session);
      return undefined;
    }
    return session;
  }

  #dropExpiredRegistrations(session: Session): void {
    const now = this.#clock.now();
    for (const ref of [...session.refs]) {
      const registration = this.#byRef.get(ref);
      if (registration === undefined || registration.expiresAt <= now) {
        session.refs.delete(ref);
        if (registration !== undefined) this.#forget(registration);
      }
    }
  }

  #dropSession(session: Session): void {
    for (const ref of session.refs) {
      const registration = this.#byRef.get(ref);
      if (registration !== undefined) {
        this.#byRef.delete(ref);
        this.#byCallbackToken.delete(registration.callbackToken);
      }
    }
    this.#sessions.delete(session.token);
  }

  #forget(registration: Registration): void {
    this.#byRef.delete(registration.ref);
    this.#byCallbackToken.delete(registration.callbackToken);
    this.#sessions.get(registration.sessionToken)?.refs.delete(registration.ref);
  }
}
