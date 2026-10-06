import { describe, expect, it, vi } from "vitest";
import { RelayState, type Clock } from "../src/state.js";
import { isWellFormedSecretToken, mintRef, mintSecretToken } from "../src/tokens.js";

const MINUTE = 60_000;

function manualClock(start = 1_000_000): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

function stateWith(
  clock: Clock,
  overrides: Partial<ConstructorParameters<typeof RelayState>[1]> = {},
) {
  return new RelayState(clock, {
    registrationTtlMs: 30 * MINUTE,
    sessionIdleTtlMs: 10 * MINUTE,
    maxSessions: 100,
    maxRegistrationsPerSession: 5,
    ...overrides,
  });
}

describe("tokens", () => {
  it("are 256-bit, base64url, and all different", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => mintSecretToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) expect(isWellFormedSecretToken(token)).toBe(true);
    // 32 bytes of base64url, unpadded.
    expect([...tokens][0]).toHaveLength(43);
  });

  it("come from the platform CSPRNG, never Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const csprng = vi.spyOn(globalThis.crypto, "getRandomValues");
    mintSecretToken();
    mintRef();
    expect(random).not.toHaveBeenCalled();
    expect(csprng).toHaveBeenCalledTimes(2);
    random.mockRestore();
    csprng.mockRestore();
  });

  it("refs are shorter than secrets, so neither can be mistaken for the other", () => {
    expect(isWellFormedSecretToken(mintRef())).toBe(false);
  });

  it("rejects anything that is not exactly the secret shape", () => {
    for (const bad of [
      "",
      "a",
      "x".repeat(42),
      "x".repeat(44),
      `${"x".repeat(42)}/`,
      `${"x".repeat(42)}=`,
    ]) {
      expect(isWellFormedSecretToken(bad)).toBe(false);
    }
  });
});

describe("sessions", () => {
  it("expire after the idle TTL when no stream is open", () => {
    const clock = manualClock();
    const state = stateWith(clock);
    const session = state.createSession();
    if (session === undefined) throw new Error("expected a session");

    clock.advance(10 * MINUTE - 1);
    expect(state.touchSession(session.token)).toBe(true);
    clock.advance(10 * MINUTE);
    expect(state.touchSession(session.token)).toBe(false);
  });

  it("do not expire while a stream is open, and count idle time from when it closed", () => {
    const clock = manualClock();
    const state = stateWith(clock);
    const session = state.createSession();
    if (session === undefined) throw new Error("expected a session");

    const unsubscribe = state.listen(
      session.token,
      () => undefined,
      () => undefined,
    );
    if (typeof unsubscribe === "string") throw new Error(unsubscribe);
    clock.advance(60 * MINUTE);
    expect(state.sweep().sessions).toBe(0);

    unsubscribe();
    clock.advance(10 * MINUTE - 1);
    expect(state.touchSession(session.token)).toBe(true);
  });

  it("refuses a new session at the cap, after trying a sweep", () => {
    const clock = manualClock();
    const state = stateWith(clock, { maxSessions: 2 });
    expect(state.createSession()).toBeDefined();
    expect(state.createSession()).toBeDefined();
    expect(state.createSession()).toBeUndefined();

    clock.advance(10 * MINUTE);
    expect(state.createSession()).toBeDefined();
  });
});

describe("stream caps (review R3)", () => {
  function open(state: RelayState, token: string): { closed: () => boolean; stop: () => void } {
    let closed = false;
    const result = state.listen(
      token,
      () => undefined,
      () => {
        closed = true;
      },
    );
    if (typeof result === "string") throw new Error(result);
    return { closed: () => closed, stop: result };
  }

  function sessionToken(state: RelayState): string {
    const session = state.createSession();
    if (session === undefined) throw new Error("expected a session");
    return session.token;
  }

  it("closes a session's oldest stream when one more opens than it may hold", () => {
    const state = stateWith(manualClock(), { maxStreamsPerSession: 2 });
    const token = sessionToken(state);
    const first = open(state, token);
    const second = open(state, token);
    const third = open(state, token);
    expect([first.closed(), second.closed(), third.closed()]).toEqual([true, false, false]);
    expect(state.counts().listeners).toBe(2);
    first.stop(); // the stream's own cleanup, after the state closed it
    expect(state.counts().listeners).toBe(2);
  });

  it("refuses a stream when the relay holds as many as it allows, and takes one again after a close", () => {
    const state = stateWith(manualClock(), { maxOpenStreams: 2 });
    const a = open(state, sessionToken(state));
    open(state, sessionToken(state));
    const third = sessionToken(state);
    expect(
      state.listen(
        third,
        () => undefined,
        () => undefined,
      ),
    ).toBe("at-capacity");
    a.stop();
    expect(
      typeof state.listen(
        third,
        () => undefined,
        () => undefined,
      ),
    ).toBe("function");
  });

  it("still makes room on a full session when the relay is at its overall cap", () => {
    const state = stateWith(manualClock(), { maxStreamsPerSession: 1, maxOpenStreams: 1 });
    const token = sessionToken(state);
    const first = open(state, token);
    const second = open(state, token);
    expect([first.closed(), second.closed()]).toEqual([true, false]);
    expect(state.counts().listeners).toBe(1);
  });

  it("ends a session at its maximum age, open stream and all", () => {
    const clock = manualClock();
    const state = stateWith(clock, { sessionMaxAgeMs: 24 * 60 * MINUTE });
    const token = sessionToken(state);
    const stream = open(state, token);
    clock.advance(24 * 60 * MINUTE - 1);
    expect(state.sweep().sessions).toBe(0);
    expect(stream.closed()).toBe(false);
    clock.advance(1);
    expect(state.sweep().sessions).toBe(1);
    expect(stream.closed()).toBe(true);
    expect(state.counts()).toMatchObject({ sessions: 0, listeners: 0 });
    expect(
      state.listen(
        token,
        () => undefined,
        () => undefined,
      ),
    ).toBe("unknown-session");
  });

  it("ends a busy session at its maximum age too", () => {
    const clock = manualClock();
    const state = stateWith(clock, { sessionMaxAgeMs: 60 * MINUTE });
    const token = sessionToken(state);
    for (let i = 0; i < 6; i++) {
      clock.advance(9 * MINUTE);
      expect(state.touchSession(token)).toBe(true);
    }
    clock.advance(6 * MINUTE);
    expect(state.touchSession(token)).toBe(false);
  });
});

describe("registrations and doorbells", () => {
  function setUp() {
    const clock = manualClock();
    const state = stateWith(clock);
    const session = state.createSession();
    if (session === undefined) throw new Error("expected a session");
    const rung: string[] = [];
    state.listen(
      session.token,
      (ref) => rung.push(ref),
      () => undefined,
    );
    const registration = state.register(session.token, "pygeoapi");
    if (typeof registration === "string") throw new Error(registration);
    return { clock, state, session, registration, rung };
  }

  it("rings the owning session with the ref, never the token", () => {
    const { state, registration, rung } = setUp();
    expect(state.ring(registration.callbackToken)).toBe("delivered");
    expect(rung).toEqual([registration.ref]);
    expect(registration.ref).not.toBe(registration.callbackToken);
  });

  it("rings again for a duplicate callback — the browser's poll is idempotent", () => {
    const { state, registration, rung } = setUp();
    state.ring(registration.callbackToken);
    state.ring(registration.callbackToken);
    expect(rung).toEqual([registration.ref, registration.ref]);
  });

  it("answers an unknown token as unknown, and rings nobody", () => {
    const { state, rung } = setUp();
    expect(state.ring(mintSecretToken())).toBe("unknown");
    expect(rung).toEqual([]);
  });

  it("treats an expired registration as unknown, before any sweep", () => {
    const { clock, state, registration, rung } = setUp();
    clock.advance(30 * MINUTE);
    expect(state.ring(registration.callbackToken)).toBe("unknown");
    expect(rung).toEqual([]);
  });

  it("says no-listener when the session is alive but has no stream open", () => {
    const clock = manualClock();
    const state = stateWith(clock);
    const session = state.createSession();
    if (session === undefined) throw new Error("expected a session");
    const registration = state.register(session.token, "pygeoapi");
    if (typeof registration === "string") throw new Error(registration);
    expect(state.ring(registration.callbackToken)).toBe("no-listener");
  });

  it("forgets a released registration", () => {
    const { state, registration } = setUp();
    state.release(registration.ref);
    expect(state.ring(registration.callbackToken)).toBe("unknown");
    expect(state.counts().registrations).toBe(0);
  });

  it("caps registrations per session, and expired ones stop counting", () => {
    const { clock, state, session } = setUp();
    for (let i = 0; i < 4; i += 1) expect(typeof state.register(session.token, "p")).toBe("object");
    expect(state.register(session.token, "p")).toBe("at-capacity");
    clock.advance(30 * MINUTE);
    expect(typeof state.register(session.token, "p")).toBe("object");
  });

  it("refuses to register against an unknown session", () => {
    const { state } = setUp();
    expect(state.register(mintSecretToken(), "p")).toBe("unknown-session");
  });

  it("sweeps expired registrations and idle sessions, reporting counts only", () => {
    const clock = manualClock();
    const state = stateWith(clock);
    const session = state.createSession();
    if (session === undefined) throw new Error("expected a session");
    state.register(session.token, "p");
    state.register(session.token, "p");

    clock.advance(10 * MINUTE);
    expect(state.sweep()).toEqual({ sessions: 1, registrations: 2 });
    expect(state.counts()).toEqual({ sessions: 0, registrations: 0, listeners: 0 });
  });
});
