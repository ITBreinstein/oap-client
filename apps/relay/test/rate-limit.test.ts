/**
 * The limiter on its own, with a hand-stepped clock: every budget, refill,
 * independent clients, the key bound and the sweep.
 */

import { describe, expect, it } from "vitest";
import { clientKey, type ClientKey } from "../src/client-address.js";
import {
  DEFAULT_RATE_LIMITS,
  RateLimiter,
  type Admitted,
  type RateLimits,
  type RateRoute,
  type Refused,
} from "../src/rate-limit.js";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const client = (address: string): ClientKey => clientKey(address, undefined, []);
const A = client("198.51.100.1");
const B = client("198.51.100.2");

function limits(overrides: Partial<RateLimits> = {}): RateLimits {
  return { ...DEFAULT_RATE_LIMITS, ...overrides };
}

function admitted(result: Admitted | Refused): Admitted {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
}

function refused(result: Admitted | Refused): Refused {
  if (result.ok) throw new Error("admitted");
  return result;
}

/** Takes `count` from `route`, all of which must be admitted. */
function spend(limiter: RateLimiter, route: RateRoute, who: ClientKey, count: number): void {
  for (let i = 0; i < count; i += 1) admitted(limiter.take(route, who));
}

describe("per-minute budgets", () => {
  it.each([
    ["sessions", 10],
    ["execute", 20],
    ["read", 240],
    ["endpoints-and-preflights", 120],
  ] as const)("%s allows %i at once, then refuses with the wait for the next", (route, budget) => {
    const limiter = new RateLimiter(clock());
    spend(limiter, route, A, budget);
    const refusal = refused(limiter.take(route, A));
    expect(refusal.code).toBe("rate-limited");
    expect(refusal.retryAfterSeconds).toBe(Math.ceil(60 / budget));
  });

  it("refills continuously, one token per sixtieth of the minute's budget", () => {
    const time = clock();
    const limiter = new RateLimiter(time);
    spend(limiter, "sessions", A, 10);
    expect(refused(limiter.take("sessions", A)).retryAfterSeconds).toBe(6);
    time.advance(5_999);
    expect(limiter.take("sessions", A).ok).toBe(false);
    time.advance(1);
    expect(limiter.take("sessions", A).ok).toBe(true);
    expect(limiter.take("sessions", A).ok).toBe(false);
    time.advance(60_000);
    spend(limiter, "sessions", A, 10);
    expect(limiter.take("sessions", A).ok).toBe(false);
  });

  it("never holds more than one minute's budget, however long the client was away", () => {
    const time = clock();
    const limiter = new RateLimiter(time);
    admitted(limiter.take("sessions", A));
    time.advance(60 * 60_000);
    spend(limiter, "sessions", A, 10);
    expect(limiter.take("sessions", A).ok).toBe(false);
  });

  it("allows no more than the budget plus what refilled, across a minute boundary", () => {
    // What a fixed window would allow twice over at 0:59 and 1:00.
    const time = clock();
    const limiter = new RateLimiter(time);
    time.advance(59_000);
    spend(limiter, "sessions", A, 10);
    time.advance(2_000);
    expect(limiter.take("sessions", A).ok).toBe(false);
  });

  it("keeps each route's budget apart", () => {
    const limiter = new RateLimiter(clock());
    spend(limiter, "sessions", A, 10);
    expect(limiter.take("sessions", A).ok).toBe(false);
    expect(limiter.take("read", A).ok).toBe(true);
  });

  it("keeps each client's budget apart", () => {
    const limiter = new RateLimiter(clock());
    spend(limiter, "sessions", A, 10);
    expect(limiter.take("sessions", A).ok).toBe(false);
    expect(limiter.take("sessions", B).ok).toBe(true);
  });

  it("counts an IPv4 client once, whichever way the socket spelled it", () => {
    const limiter = new RateLimiter(clock());
    spend(limiter, "sessions", client("::ffff:198.51.100.1"), 5);
    spend(limiter, "sessions", client("198.51.100.1"), 5);
    expect(limiter.take("sessions", client("::ffff:c633:6401")).ok).toBe(false);
  });

  it("counts every address in an IPv6 /64 as one client", () => {
    const limiter = new RateLimiter(clock());
    for (let i = 1; i <= 10; i += 1) {
      admitted(limiter.take("sessions", client(`2001:db8:5:6::${i.toString(16)}`)));
    }
    expect(limiter.take("sessions", client("2001:db8:5:6:ffff::1")).ok).toBe(false);
    expect(limiter.take("sessions", client("2001:db8:5:7::1")).ok).toBe(true);
  });

  it("takes its budgets from the config", () => {
    const limiter = new RateLimiter(
      clock(),
      limits({ perClient: { ...DEFAULT_RATE_LIMITS.perClient, sessionsPerMinute: 2 } }),
    );
    spend(limiter, "sessions", A, 2);
    expect(refused(limiter.take("sessions", A)).retryAfterSeconds).toBe(30);
  });
});

describe("open streams", () => {
  it("allows four per client at once, and a fifth once one closes", () => {
    const limiter = new RateLimiter(clock());
    const held = [1, 2, 3, 4].map(() => admitted(limiter.openStream(A)));
    const refusal = refused(limiter.openStream(A));
    expect(refusal).toMatchObject({ code: "rate-limited", retryAfterSeconds: 1 });
    expect(limiter.openStream(B).ok).toBe(true);
    held[0]?.release();
    held[0]?.release(); // twice gives back one slot, not two
    admitted(limiter.openStream(A));
    expect(limiter.openStream(A).ok).toBe(false);
  });
});

describe("upstream slots", () => {
  it("allows six in flight per client, and gives one back on release", () => {
    const limiter = new RateLimiter(clock());
    const slots = [1, 2, 3, 4, 5, 6].map(() => admitted(limiter.beginForward(A, "zoo")));
    expect(refused(limiter.beginForward(A, "zoo"))).toMatchObject({
      code: "rate-limited",
      retryAfterSeconds: 1,
    });
    expect(limiter.beginForward(B, "zoo").ok).toBe(true);
    slots[0]?.release();
    slots[0]?.release();
    admitted(limiter.beginForward(A, "zoo"));
    expect(limiter.beginForward(A, "zoo").ok).toBe(false);
  });

  it("refuses an endpoint's 601st request in a minute across all clients, and only that endpoint's", () => {
    const limiter = new RateLimiter(clock());
    for (let i = 0; i < 600; i += 1) {
      const slot = admitted(limiter.beginForward(client(`198.51.100.${String(i % 200)}`), "zoo"));
      slot.release();
    }
    const refusal = refused(limiter.beginForward(client("203.0.113.9"), "zoo"));
    expect(refusal.code).toBe("rate-limited-endpoint");
    expect(refusal.retryAfterSeconds).toBe(1);
    expect(limiter.beginForward(client("203.0.113.9"), "other").ok).toBe(true);
  });

  it("refuses an endpoint's 33rd request in flight across all clients", () => {
    const limiter = new RateLimiter(clock());
    const slots = Array.from({ length: 32 }, (_, i) =>
      admitted(limiter.beginForward(client(`198.51.100.${String(i)}`), "zoo")),
    );
    expect(refused(limiter.beginForward(B, "zoo")).code).toBe("rate-limited-endpoint");
    slots[5]?.release();
    expect(limiter.beginForward(B, "zoo").ok).toBe(true);
  });

  it("takes nothing when it refuses: a refused request holds no slot and spends no token", () => {
    const limiter = new RateLimiter(
      clock(),
      limits({ perEndpoint: { requestsPerMinute: 2, inFlight: 1 } }),
    );
    const first = admitted(limiter.beginForward(A, "zoo"));
    for (let i = 0; i < 10; i += 1) expect(limiter.beginForward(B, "zoo").ok).toBe(false);
    first.release();
    // The ten refusals spent none of the endpoint's two tokens for the minute…
    admitted(limiter.beginForward(B, "zoo")).release();
    // …and held none of B's six slots.
    for (let i = 1; i <= 6; i += 1) admitted(limiter.beginForward(B, `e${String(i)}`));
    expect(refused(limiter.beginForward(B, "e7")).code).toBe("rate-limited");
  });
});

describe("memory", () => {
  it("forgets a client whose buckets are full again, and keeps one still spending", () => {
    const time = clock();
    const limiter = new RateLimiter(time);
    admitted(limiter.take("read", A));
    spend(limiter, "sessions", B, 10);
    expect(limiter.counts().trackedKeys).toBe(2);
    time.advance(250); // A's one read token is back; B's ten sessions are not
    expect(limiter.sweep()).toBe(1);
    expect(limiter.counts().trackedKeys).toBe(1);
    expect(limiter.take("sessions", B).ok).toBe(false);
  });

  it("never forgets a client with something in flight or a stream open", () => {
    const time = clock();
    const limiter = new RateLimiter(time);
    const slot = admitted(limiter.beginForward(A, "zoo"));
    const stream = admitted(limiter.openStream(B));
    time.advance(10 * 60_000);
    expect(limiter.sweep()).toBe(0);
    slot.release();
    stream.release();
    expect(limiter.sweep()).toBe(2);
  });

  it("at the key bound, newcomers share one overflow entry; tracked clients keep theirs", () => {
    const time = clock();
    const limiter = new RateLimiter(time, limits({ maxTrackedClients: 2 }));
    spend(limiter, "sessions", A, 10);
    spend(limiter, "sessions", B, 1);
    // Both are still spending, so neither can be forgotten to make room.
    const C = client("198.51.100.3");
    const D = client("198.51.100.4");
    spend(limiter, "sessions", C, 6);
    spend(limiter, "sessions", D, 4);
    expect(limiter.take("sessions", D).ok).toBe(false); // C and D share ten
    expect(limiter.take("sessions", A).ok).toBe(false); // A kept its own, spent, bucket
    expect(limiter.take("sessions", B).ok).toBe(true); // and B its own
    expect(limiter.counts().trackedKeys).toBe(2);
    expect(limiter.report()?.overflowBucket).toBe(11);

    time.advance(60_000); // everyone's buckets are full again
    const E = client("198.51.100.5");
    spend(limiter, "sessions", E, 10);
    expect(limiter.take("sessions", E).ok).toBe(false);
    expect(limiter.take("sessions", D).ok).toBe(true); // D got its own entry back
  });
});

describe("the minute's report", () => {
  it("counts refusals by limit, never by client, and starts again after each report", () => {
    const limiter = new RateLimiter(clock());
    spend(limiter, "sessions", A, 10);
    limiter.take("sessions", A);
    limiter.take("sessions", A);
    const slots = [1, 2, 3, 4, 5, 6].map(() => admitted(limiter.beginForward(B, "zoo")));
    limiter.beginForward(B, "zoo");
    const report = limiter.report();
    expect(report).toEqual({
      rateLimit: { "in-flight": 1, sessions: 2 },
      unknownBucket: 0,
      overflowBucket: 0,
      trackedKeys: 2,
    });
    expect(JSON.stringify(report)).not.toMatch(/198\.51\.100/);
    expect(limiter.report()).toBeUndefined();
    for (const slot of slots) slot.release();
  });

  it("names the endpoint, and only its key, for the per-endpoint ceiling", () => {
    const limiter = new RateLimiter(
      clock(),
      limits({ perEndpoint: { requestsPerMinute: 1, inFlight: 32 } }),
    );
    admitted(limiter.beginForward(A, "zoo")).release();
    limiter.beginForward(A, "zoo");
    expect(limiter.report()?.rateLimit).toEqual({ "endpoint:zoo": 1 });
  });

  it("reports requests in the shared unknown bucket even when nothing was refused", () => {
    const limiter = new RateLimiter(clock());
    const unknown = clientKey("172.17.0.1", undefined, [
      { family: 4, value: 0xac110001n, prefix: 32 },
    ]);
    limiter.take("read", unknown);
    limiter.take("read", unknown);
    expect(limiter.report()).toEqual({
      rateLimit: {},
      unknownBucket: 2,
      overflowBucket: 0,
      trackedKeys: 1,
    });
  });
});
