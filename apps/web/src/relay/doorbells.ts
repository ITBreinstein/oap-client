/**
 * The doorbell stream: the relay's server-sent events, read with `fetch`.
 *
 * Not `EventSource`, for two reasons. `EventSource` cannot send an
 * `Authorization` header, so the session token would have to ride in the URL,
 * where proxies and logs keep it. And it reconnects on its own schedule and
 * does not surface a 401, which is exactly the signal that the relay restarted
 * and forgot this session.
 *
 * What it promises the caller:
 *
 * - `onDoorbell(ref)` for every `job` event. A ref, never a state.
 * - `onOpen` every time the stream is (re)established — including after the
 *   relay restarted and a new session had to be opened. Doorbells rung while
 *   the stream was down are lost, by design; the caller reconciles on open.
 * - It never gives up. A relay that is down is retried with capped backoff,
 *   and the page keeps polling in the meantime.
 * - A stream gone silent is treated as dropped. The relay writes at least a
 *   keepalive every 15 s; a connection left half-open by a sleep or a network
 *   change would otherwise look open for good while every doorbell is lost.
 */

import { parseDoorbell } from "./contract.js";
import type { RelayClient } from "./relay-client.js";
import type { SessionSource } from "./routed-fetch.js";

/** Run `callback` after `ms`; the returned function cancels it. */
export type Schedule = (callback: () => void, ms: number) => () => void;

export const systemSchedule: Schedule = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => {
    clearTimeout(handle);
  };
};

export type StreamState = "connecting" | "open" | "waiting" | "closed";

export interface DoorbellOptions {
  readonly relay: RelayClient;
  readonly onDoorbell: (ref: string) => void;
  readonly onOpen: (info: {
    readonly reconnect: boolean;
    readonly sessionRenewed: boolean;
  }) => void;
  readonly onState?: ((state: StreamState) => void) | undefined;
  readonly schedule?: Schedule | undefined;
  readonly initialBackoffMs?: number | undefined;
  readonly maxBackoffMs?: number | undefined;
  /** How long an open stream may send nothing before it is dropped and reopened. */
  readonly silenceMs?: number | undefined;
}

export interface DoorbellStream extends SessionSource {
  close(): void;
}

export const INITIAL_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
/** Three of the relay's 15 s keepalives missed: the stream is gone, whatever the socket says. */
export const SILENCE_MS = 45_000;

/**
 * Feed `onEvent` one dispatched event per blank-line-terminated block, as the
 * HTML event-stream format defines it: `event:` names it, `data:` lines join
 * with newlines, comment lines (`:`) are ignored.
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  onActivity?: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  const dispatch = (): void => {
    if (data.length > 0 || event !== "") onEvent(event === "" ? "message" : event, data.join("\n"));
    event = "";
    data = [];
  };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return;
    onActivity?.();
    buffer += decoder.decode(chunk.value, { stream: true });
    let newline = buffer.search(/\r\n|\r|\n/);
    // A `\r` at the very end may be the first half of a `\r\n` split across
    // chunks; read on before deciding, or the `\n` reads as a blank line.
    while (newline !== -1 && !(newline === buffer.length - 1 && buffer[newline] === "\r")) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
      if (line === "") dispatch();
      else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      newline = buffer.search(/\r\n|\r|\n/);
    }
  }
}

export function openDoorbells(options: DoorbellOptions): DoorbellStream {
  const schedule = options.schedule ?? systemSchedule;
  const initialBackoff = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;
  const maxBackoff = options.maxBackoffMs ?? MAX_BACKOFF_MS;
  const silenceMs = options.silenceMs ?? SILENCE_MS;

  let session: string | undefined;
  let closed = false;
  let opens = 0;
  let renewed = false;
  let backoff = initialBackoff;
  let stream: AbortController | undefined;
  let cancelWait: (() => void) | undefined;
  /**
   * Set by renew(): reconnect on the new session without backing off. On an
   * object because callbacks change it, and a `let` would be narrowed.
   */
  const flags = { reconnectNow: false };

  // Read through a function inside the loop: `while (!closed)` would otherwise
  // narrow it to false for the whole body, and close() changes it meanwhile.
  const isClosed = (): boolean => closed;

  const setState = (state: StreamState): void => {
    options.onState?.(state);
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const cancel = schedule(resolve, ms);
      cancelWait = () => {
        cancel();
        resolve();
      };
    });

  const newSession = async (): Promise<string> => {
    const grant = await options.relay.createSession();
    session = grant.token;
    renewed = opens > 0;
    return grant.token;
  };

  /**
   * Restarted on every chunk. When it fires the stream has said nothing for
   * `silenceMs`, and is aborted so the loop below reconnects.
   */
  let cancelWatchdog: () => void = () => undefined;
  const armWatchdog = (): void => {
    cancelWatchdog();
    cancelWatchdog = schedule(() => {
      stream?.abort();
    }, silenceMs);
  };

  const run = async (): Promise<void> => {
    let unauthorisedInARow = 0;
    while (!closed) {
      setState("connecting");
      try {
        const token = session ?? (await newSession());
        stream = new AbortController();
        const response = await options.relay.openEvents(token, stream.signal);
        if (response.status === 401) {
          // The relay forgot this session: it restarted, or the session idled
          // out. Open a new one straight away — once. A relay that forgets
          // fresh sessions too is broken, and waits like any other failure.
          session = undefined;
          unauthorisedInARow += 1;
          if (unauthorisedInARow === 1) continue;
          throw new Error("relay keeps refusing new sessions");
        }
        if (!response.ok || response.body === null) {
          throw new Error(`event stream answered ${String(response.status)}`);
        }
        unauthorisedInARow = 0;
        armWatchdog();
        await readEventStream(
          response.body,
          (event, data) => {
            if (event === "ready") {
              backoff = initialBackoff;
              flags.reconnectNow = false;
              setState("open");
              options.onOpen({ reconnect: opens > 0, sessionRenewed: renewed });
              opens += 1;
              renewed = false;
            } else if (event === "job") {
              const ref = parseDoorbell(data);
              if (ref !== undefined) options.onDoorbell(ref);
            }
          },
          armWatchdog,
        );
      } catch {
        // Down, unreachable, gone silent, or aborted by close() or renew().
        // The loop condition and the backoff below decide what happens next.
      } finally {
        cancelWatchdog();
      }
      if (isClosed()) break;
      if (flags.reconnectNow) {
        flags.reconnectNow = false;
        continue;
      }
      setState("waiting");
      await wait(backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    }
    setState("closed");
  };

  void run();

  /**
   * The renewal in progress, shared. Several requests can learn at once that
   * the relay forgot the session — a restart fails them all — and one new
   * session serves them all. A session each would leave jobs registered on
   * sessions this page no longer listens to, and their doorbells unheard.
   */
  let renewing: Promise<string | undefined> | undefined;

  return {
    current: () => session,
    renew() {
      renewing ??= (async () => {
        try {
          const token = await newSession();
          // Reconnect on the new session, so doorbells for the next job reach
          // this page and the reconnect triggers a reconciliation.
          flags.reconnectNow = true;
          stream?.abort();
          cancelWait?.();
          return token;
        } catch {
          return undefined;
        } finally {
          renewing = undefined;
        }
      })();
      return renewing;
    },
    close() {
      closed = true;
      stream?.abort();
      cancelWait?.();
    },
  };
}
