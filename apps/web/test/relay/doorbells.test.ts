// @vitest-environment node
/**
 * The doorbell stream, against a relay whose event streams the test writes by
 * hand. Covers the three event-stream cases: delivery, a reconnect
 * triggering reconciliation, and a relay restart in the middle of a job.
 */

import type { JobState, JobStatus } from "@breinstein/oap-client";
import { describe, expect, it } from "vitest";
import { openDoorbells, readEventStream, SILENCE_MS } from "../../src/relay/doorbells.js";
import { JobReconciler } from "../../src/relay/reconciler.js";
import type { RelayClient } from "../../src/relay/relay-client.js";
import { manualSchedule, settle, status } from "./harness.js";

/** One event stream the test controls. */
function controlledStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    send(text: string) {
      controller?.enqueue(encoder.encode(text));
    },
    end() {
      controller?.close();
    },
    /** What an aborted `fetch` does to the body it was reading. */
    abort() {
      controller?.error(new DOMException("aborted", "AbortError"));
    },
  };
}

/**
 * A relay that knows the sessions it issued, can be "restarted" to forget them
 * all, and hands each accepted stream to the test.
 */
function fakeRelay() {
  let known = new Set<string>();
  let issued = 0;
  const streams: ReturnType<typeof controlledStream>[] = [];
  const opened: string[] = [];
  let down = false;
  const relay: RelayClient = {
    baseUrl: "http://relay.test",
    endpoints: () => Promise.resolve([]),
    execute: () => Promise.reject(new Error("not used")),
    forward: () => Promise.reject(new Error("not used")),
    createSession: () => {
      if (down) return Promise.reject(new TypeError("relay unreachable"));
      issued += 1;
      const token = `session-${String(issued)}`;
      known.add(token);
      return Promise.resolve({ token, expiresAt: 0 });
    },
    openEvents: (token, signal) => {
      opened.push(token);
      if (down) return Promise.reject(new TypeError("relay unreachable"));
      if (!known.has(token)) return Promise.resolve(new Response(null, { status: 401 }));
      const stream = controlledStream();
      signal?.addEventListener("abort", () => {
        stream.abort();
      });
      streams.push(stream);
      return Promise.resolve(stream.response);
    },
  };
  return {
    relay,
    streams,
    opened,
    latest: () => {
      const stream = streams.at(-1);
      if (stream === undefined) throw new Error("no stream open");
      return stream;
    },
    restart() {
      known = new Set();
      for (const stream of streams) stream.end();
    },
    setDown(value: boolean) {
      down = value;
    },
  };
}

describe("readEventStream", () => {
  it("parses events across chunk boundaries, CRLF, multi-line data and comments", async () => {
    const stream = controlledStream();
    const events: [string, string][] = [];
    const done = readEventStream(stream.response.body ?? new ReadableStream(), (event, data) =>
      events.push([event, data]),
    );
    stream.send("event: rea");
    stream.send("dy\r\ndata: {}\r\n\r\n: keepalive\n\n");
    stream.send('event: job\ndata: {"ref":\ndata: "a"}\n\n');
    stream.send("data: plain\n\n");
    stream.end();
    await done;
    expect(events).toEqual([
      ["ready", "{}"],
      ["job", '{"ref":\n"a"}'],
      ["message", "plain"],
    ]);
  });

  it("does not read a CRLF split across two chunks as a blank line", async () => {
    const stream = controlledStream();
    const events: [string, string][] = [];
    const done = readEventStream(stream.response.body ?? new ReadableStream(), (event, data) =>
      events.push([event, data]),
    );
    stream.send("event: job\r");
    stream.send('\ndata: {"ref":"a"}\r');
    stream.send("\n\r\n");
    stream.end();
    await done;
    expect(events).toEqual([["job", '{"ref":"a"}']]);
  });
});

describe("openDoorbells", () => {
  it("delivers a job event as a ref, and nothing else", async () => {
    const relay = fakeRelay();
    const rung: string[] = [];
    const opens: unknown[] = [];
    const doorbells = openDoorbells({
      relay: relay.relay,
      schedule: manualSchedule().schedule,
      onDoorbell: (ref) => rung.push(ref),
      onOpen: (info) => opens.push(info),
    });
    await settle();

    relay.latest().send("event: ready\ndata: {}\n\n");
    relay.latest().send('event: job\ndata: {"ref":"r1"}\n\n');
    relay.latest().send('event: job\ndata: {"status":"successful"}\n\n');
    relay.latest().send("event: job\ndata: not json\n\n");
    await settle();

    expect(opens).toEqual([{ reconnect: false, sessionRenewed: false }]);
    expect(rung).toEqual(["r1"]);
    expect(doorbells.current()).toBe("session-1");
    doorbells.close();
  });

  it("reconnects after the stream drops, and says so — the caller reconciles", async () => {
    const relay = fakeRelay();
    const timers = manualSchedule();
    const opens: { reconnect: boolean; sessionRenewed: boolean }[] = [];
    const doorbells = openDoorbells({
      relay: relay.relay,
      schedule: timers.schedule,
      onDoorbell: () => undefined,
      onOpen: (info) => opens.push(info),
      initialBackoffMs: 1_000,
    });
    await settle();
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();

    relay.latest().end();
    await settle();
    expect(timers.pending()).toEqual([1_000]);
    await timers.advance(1_000);
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();

    expect(opens).toEqual([
      { reconnect: false, sessionRenewed: false },
      { reconnect: true, sessionRenewed: false },
    ]);
    // Same session: the relay did not forget it.
    expect(relay.opened).toEqual(["session-1", "session-1"]);
    doorbells.close();
  });

  it("backs off while the relay is down, capped, and never gives up", async () => {
    const relay = fakeRelay();
    relay.setDown(true);
    const timers = manualSchedule();
    const doorbells = openDoorbells({
      relay: relay.relay,
      schedule: timers.schedule,
      onDoorbell: () => undefined,
      onOpen: () => undefined,
      initialBackoffMs: 1_000,
      maxBackoffMs: 4_000,
    });
    await settle();

    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const [next] = timers.pending();
      if (next === undefined) throw new Error("expected a retry");
      waits.push(next);
      await timers.advance(next);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 4_000, 4_000]);
    doorbells.close();
    await timers.advance(10_000);
    expect(timers.pending()).toEqual([]);
  });

  it("renew() moves to a new session and reconnects without waiting", async () => {
    const relay = fakeRelay();
    const timers = manualSchedule();
    const opens: { reconnect: boolean; sessionRenewed: boolean }[] = [];
    const doorbells = openDoorbells({
      relay: relay.relay,
      schedule: timers.schedule,
      onDoorbell: () => undefined,
      onOpen: (info) => opens.push(info),
    });
    await settle();
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();

    expect(await doorbells.renew()).toBe("session-2");
    await settle();
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();

    expect(relay.opened).toEqual(["session-1", "session-2"]);
    expect(opens.at(-1)).toEqual({ reconnect: true, sessionRenewed: true });
    // No backoff wait: the one timer is the open stream's silence watchdog.
    expect(timers.pending()).toEqual([SILENCE_MS]);
    doorbells.close();
  });

  it("shares one renewal between callers that ask at the same time", async () => {
    const relay = fakeRelay();
    const timers = manualSchedule();
    const doorbells = openDoorbells({
      relay: relay.relay,
      schedule: timers.schedule,
      onDoorbell: () => undefined,
      onOpen: () => undefined,
    });
    await settle();
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();

    // A relay restart fails every request in flight with unknown-session.
    const tokens = await Promise.all([doorbells.renew(), doorbells.renew(), doorbells.renew()]);
    await settle();

    expect(tokens).toEqual(["session-2", "session-2", "session-2"]);
    expect(relay.opened).toEqual(["session-1", "session-2"]);
    doorbells.close();
  });

  it("drops a stream that has gone silent and reconnects, so the caller reconciles", async () => {
    const relay = fakeRelay();
    const timers = manualSchedule();
    const opens: { reconnect: boolean }[] = [];
    const doorbells = openDoorbells({
      relay: relay.relay,
      schedule: timers.schedule,
      onDoorbell: () => undefined,
      onOpen: (info) => opens.push(info),
      initialBackoffMs: 1_000,
      silenceMs: 45_000,
    });
    await settle();
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();

    // A keepalive resets the watchdog; silence after it does not.
    await timers.advance(40_000);
    relay.latest().send(": keepalive\n\n");
    await settle();
    await timers.advance(40_000);
    expect(relay.opened).toEqual(["session-1"]);

    await timers.advance(5_000 + 1_000);
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();

    expect(relay.opened).toEqual(["session-1", "session-1"]);
    expect(opens.at(-1)).toEqual({ reconnect: true, sessionRenewed: false });
    doorbells.close();
  });
});

describe("a relay restart in the middle of a job", () => {
  it("opens a new session, reconnects, and the reconnect finds the finished job", async () => {
    const relay = fakeRelay();
    const timers = manualSchedule();
    let serverState: JobState = "accepted";
    const reads: string[] = [];
    const reconciler = new JobReconciler({
      readJob: (url): Promise<JobStatus> => {
        reads.push(url);
        return Promise.resolve(status(serverState, url));
      },
      onChange: () => undefined,
      schedule: timers.schedule,
      // Long baseline, so only the reconnect can explain a prompt read.
      baselineMs: 60_000,
      coalesceMs: 250,
    });
    const doorbells = openDoorbells({
      relay: relay.relay,
      schedule: timers.schedule,
      onDoorbell: (ref) => {
        reconciler.doorbell(ref);
      },
      onOpen: ({ reconnect }) => {
        if (reconnect) reconciler.reconnected();
      },
      initialBackoffMs: 1_000,
    });
    await settle();
    relay.latest().send("event: ready\ndata: {}\n\n");
    reconciler.track("http://ogc.test/jobs/7", "ref-7");
    await settle();
    expect(reads).toHaveLength(1);

    // The relay restarts. Its streams end and it forgets every session and
    // every registration — so the success callback for ref-7 will never ring.
    relay.restart();
    serverState = "successful";
    await settle();

    // One backoff later: the old session is refused (401), a new one is
    // opened at once, and the stream comes back.
    await timers.advance(1_000);
    relay.latest().send("event: ready\ndata: {}\n\n");
    await settle();
    await timers.advance(250);

    expect(relay.opened).toEqual(["session-1", "session-1", "session-2"]);
    expect(reads).toHaveLength(2);
    expect(reconciler.jobs()[0]?.status?.status).toBe("successful");
    expect(reconciler.jobs()[0]?.settled).toBe(true);
    doorbells.close();
    reconciler.dispose();
  });
});
