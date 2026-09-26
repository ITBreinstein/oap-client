/**
 * The core's `.http` captures (`curl -i`: status line, headers, body) as
 * responses and envelopes, for the result tests. Read with Vite's glob import,
 * so the fixtures stay where the core keeps them and nothing here touches the
 * file system.
 */

import { createEnvelope, type ResponseEnvelope } from "@breinstein/oap-client";

const RAW: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../../../packages/core/test/fixtures/**/*.http", {
      eager: true,
      query: "?raw",
      import: "default",
    }),
  ).map(([path, text]) => [path.replace(/^.*\/fixtures\//, ""), text]),
);

export interface HttpFixture {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
}

/** `server/dir/name.http`, relative to `packages/core/test/fixtures/`. */
export function httpFixture(key: string): HttpFixture {
  const text = RAW[key];
  if (text === undefined) throw new Error(`no fixture ${key}`);
  const separator = /\r?\n\r?\n/.exec(text);
  const head = separator === null ? text : text.slice(0, separator.index);
  const body = separator === null ? "" : text.slice(separator.index + separator[0].length);
  const [statusLine = "", ...lines] = head.split(/\r?\n/);
  const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(statusLine)?.[1]);
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    // curl has already undone the chunking; the body here is whole.
    if (name.toLowerCase() === "transfer-encoding") continue;
    headers.append(name, line.slice(colon + 1).trim());
  }
  return { status, headers, body };
}

export function responseOf(key: string, headers: Record<string, string> = {}): Response {
  const fixture = httpFixture(key);
  const merged = new Headers(fixture.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(fixture.body, { status: fixture.status, headers: merged });
}

export function envelopeOf(key: string, url: string): ResponseEnvelope {
  return createEnvelope(responseOf(key), { requestedUrl: url });
}

/** The JSON body of a capture. */
export function jsonOf(key: string): unknown {
  return JSON.parse(httpFixture(key).body) as unknown;
}
