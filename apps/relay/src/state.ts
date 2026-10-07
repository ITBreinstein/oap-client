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

import { DEFAULT_LIMITS, DEFAULT_SESSION_MAX_AGE_MS, type RelayConfig } from "./config.js";
import { mintRef, mintSecretToken } from "./tokens.js";

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** The three `subscriber` members, as path segments. */
export const CALLBACK_KINDS = ["success", "in-progress", "failed"] as const;
export type CallbackKind = (typeof CALLBACK_KINDS)[number];

/**
 * Told that the server called one of the callbacks of the job behind `ref`,
 * and which. Never told anything the server sent with it.
 */
export type DoorbellListener = (ref: string, callback: CallbackKind) => void;

export interface Registration {
  readonly ref: string;
  readonly callbackToken: string;
  readonly sessionToken: string;
  readonly endpointKey: string;
  readonly expiresAt: number;
}

interface Session {
  readonly token: string;
  readonly createdAt: number;
  lastSeen: number;
  /** Each open stream's listener, with the function that ends that stream. In opening order. */
  readonly listeners: Map<DoorbellListener, () => void>;
  readonly refs: Set<string>;
}

export interface StateOptions {
  readonly registrationTtlMs: number;
  readonly sessionIdleTtlMs: number;
  readonly maxSessions: number;
  readonly maxRegistrationsPerSession: number;
  /** Defaults to {@link DEFAULT_SESSION_MAX_AGE_MS}. */
  readonly sessionMaxAgeMs?: number;
  /** Defaults to the config default; see `RelayLimits`. */
  readonly maxStreamsPerSession?: number;
  /** Defaults to the config default; see `RelayLimits`. */
  readonly maxOpenStreams?: number;
}

/** The state's options as the config sets them. */
export function stateOptionsFrom(config: RelayConfig): StateOptions {
  return {
    registrationTtlMs: config.registrationTtlMs,
    sessionIdleTtlMs: config.sessionIdleTtlMs,
    sessionMaxAgeMs: config.sessionMaxAgeMs,
    maxSessions: config.limits.maxSessions,
    maxRegistrationsPerSession: config.limits.maxRegistrationsPerSession,
    maxStreamsPerSession: config.limits.maxStreamsPerSession,
    maxOpenStreams: config.limits.maxOpenStreams,
  };
}

/**
 * `unknown` covers never-issued, expired and swept alike. The caller answers
 * all three the same way, so they are not distinguished here either.
 */
export type RingOutcome = "delivered" | "no-listener" | "unknown";

export class RelayState {
  readonly #clock: Clock;
  readonly #options: Required<StateOptions>;
  readonly #sessions = new Map<string, Session>();
  #openStreams = 0;
  readonly #byCallbackToken = new Map<string, Registration>();
  readonly #byRef = new Map<string, Registration>();

  constructor(clock: Clock, options: StateOptions) {
    this.#clock = clock;
    this.#options = {
      sessionMaxAgeMs: DEFAULT_SESSION_MAX_AGE_MS,
      maxStreamsPerSession: DEFAULT_LIMITS.maxStreamsPerSession,
      maxOpenStreams: DEFAULT_LIMITS.maxOpenStreams,
      ...options,
    };
  }

  /** A new session, or `undefined` when the relay is at its session cap. */
  createSession(): { token: string; expiresAt: number } | undefined {
    if (this.#sessions.size >= this.#options.maxSessions) {
      this.sweep();
      if (this.#sessions.size >= this.#options.maxSessions) return undefined;
    }
    const now = this.#clock.now();
    const token = mintSecretToken();
    this.#sessions.set(token, {
      token,
      createdAt: now,
      lastSeen: now,
      listeners: new Map(),
      refs: new Set(),
    });
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
   * Subscribe a stream to a session's doorbells. `close` ends that stream: the
   * state calls it when it closes the stream itself, to make room for a newer
   * one on the same session or because the session ended.
   *
   * Returns the unsubscribe function; `unknown-session` when the session is
   * unknown or expired, which the browser reads as "open a new session", not
   * as an error; or `at-capacity` when the relay holds as many streams as it
   * allows. Neither cap used to exist: one session could hold any number of
   * streams, and a session with one open never ended (review R3).
   */
  listen(
    token: string,
    listener: DoorbellListener,
    close: () => void,
  ): (() => void) | "unknown-session" | "at-capacity" {
    const session = this.#liveSession(token);
    if (session === undefined) return "unknown-session";
    if (session.listeners.size >= this.#options.maxStreamsPerSession) {
      // Make room on the session by closing its oldest stream. The total is
      // unchanged, so the overall cap does not apply.
      const oldest = session.listeners.entries().next();
      if (!oldest.done) this.#closeStream(session, ...oldest.value);
    } else if (this.#openStreams >= this.#options.maxOpenStreams) {
      return "at-capacity";
    }
    session.lastSeen = this.#clock.now();
    session.listeners.set(listener, close);
    this.#openStreams += 1;
    return () => {
      if (session.listeners.delete(listener)) this.#openStreams -= 1;
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
   * owning session with the registration's ref and which of the three URIs
   * was called, and nothing else: anything in the request stays here. The
   * page uses the URI only to know a success callback was delivered (W14).
   */
  ring(callbackToken: string, callback: CallbackKind): RingOutcome {
    const registration = this.#byCallbackToken.get(callbackToken);
    if (registration === undefined) return "unknown";
    if (registration.expiresAt <= this.#clock.now()) {
      this.#forget(registration);
      return "unknown";
    }
    const session = this.#liveSession(registration.sessionToken);
    if (session === undefined) return "unknown";
    if (session.listeners.size === 0) return "no-listener";
    for (const listener of session.listeners.keys()) listener(registration.ref, callback);
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
    return {
      sessions: this.#sessions.size,
      registrations: this.#byRef.size,
      listeners: this.#openStreams,
    };
  }

  #isExpired(session: Session, now: number): boolean {
    // However busy: an open stream used to keep a session for ever.
    if (session.createdAt + this.#options.sessionMaxAgeMs <= now) return true;
    // A session with an open stream is otherwise in use.
    return session.listeners.size === 0 && session.lastSeen + this.#options.sessionIdleTtlMs <= now;
  }

  #closeStream(session: Session, listener: DoorbellListener, close: () => void): void {
    session.listeners.delete(listener);
    this.#openStreams -= 1;
    close();
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
    for (const [listener, close] of [...session.listeners]) {
      this.#closeStream(session, listener, close);
    }
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
