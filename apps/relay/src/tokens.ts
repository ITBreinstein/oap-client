/**
 * Unguessable identifiers, from the platform CSPRNG and nothing else.
 *
 * Three kinds, deliberately different, so that knowing one grants nothing the
 * others protect:
 *
 * - a **session token** reads a browser's event stream. Secret; travels only
 *   between the browser and the relay, in an `Authorization` header.
 * - a **callback token** is embedded in the subscriber URLs handed to an OGC
 *   server. It can do exactly one thing — ring the doorbell for one job — and
 *   it must be assumed public: pygeoapi logs the URL and, when delivery fails,
 *   writes it into the job's `message` for anyone to read (finding 0047).
 * - a **ref** names a registration to the browser. Not secret; the browser
 *   needs it to match a doorbell to a job, and it opens nothing.
 */

import { Buffer } from "node:buffer";

export const SECRET_TOKEN_BYTES = 32;
export const REF_BYTES = 12;

function randomBase64Url(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  // Web Crypto, the platform CSPRNG: the same source as `node:crypto`, reached
  // through the global so it can be observed in a test.
  globalThis.crypto.getRandomValues(buffer);
  return Buffer.from(buffer).toString("base64url");
}

/** 256 bits: the session token and the callback token. */
export function mintSecretToken(): string {
  return randomBase64Url(SECRET_TOKEN_BYTES);
}

/** 96 bits: unique, not secret. */
export function mintRef(): string {
  return randomBase64Url(REF_BYTES);
}

/**
 * The shape both secret kinds share, checked before any lookup so that a
 * malformed path segment never reaches a map, a log line or a comparison.
 */
const SECRET_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedSecretToken(value: string): boolean {
  return SECRET_TOKEN_SHAPE.test(value);
}
