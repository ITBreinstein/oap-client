/**
 * Who is asking: the key the rate limits count against.
 *
 * The key is the address of the socket the request arrived on, unless that
 * socket belongs to a proxy listed in `trustedProxies`. Only then is
 * `X-Forwarded-For` read, and only its **rightmost** entry: the one our own
 * proxy wrote. Anything to its left was sent by the client and proves nothing.
 * Caddy, without `trusted_proxies` of its own, replaces the header rather than
 * appending to it, so in practice there is one entry; reading the rightmost is
 * what stays right if that ever changes.
 *
 * - An IPv4-mapped IPv6 address (`::ffff:172.17.0.1`), which is how a
 *   dual-stack Node listener reports an IPv4 peer, is taken as the IPv4
 *   address it carries, for comparing and for keying.
 * - An IPv6 client is keyed by its /64: one household or one device is often
 *   given a whole /64, and every address in it is the same client.
 * - A trusted proxy that sends no `X-Forwarded-For`, or one that cannot be
 *   read, is a misconfiguration. All such requests share one key,
 *   {@link UNKNOWN_CLIENT}, so they are limited together rather than not at
 *   all, and the relay's minute line counts them.
 *
 * A key is an address or a /64, so it never leaves memory: nothing here logs.
 */

import { isIP } from "node:net";

/** The shared key for requests from a trusted proxy that named no readable client. */
export const UNKNOWN_CLIENT = "unknown";

/** An IP address as a number, IPv4-mapped addresses already taken as IPv4. */
export interface IpAddress {
  readonly family: 4 | 6;
  readonly value: bigint;
}

/** An address and a prefix length: a single address has the family's full length. */
export interface IpNetwork extends IpAddress {
  readonly prefix: number;
}

const BITS = { 4: 32, 6: 128 } as const;
const IPV4_MAPPED_PREFIX = 0xffffn << 32n;

function ipv4Value(text: string): bigint {
  return text.split(".").reduce((value, octet) => (value << 8n) | BigInt(Number(octet)), 0n);
}

/** The eight 16-bit groups of a valid IPv6 literal, a trailing dotted quad included. */
function ipv6Value(text: string): bigint {
  let groups = text;
  const lastColon = groups.lastIndexOf(":");
  const tail = groups.slice(lastColon + 1);
  if (tail.includes(".")) {
    const quad = ipv4Value(tail);
    groups = `${groups.slice(0, lastColon + 1)}${(quad >> 16n).toString(16)}:${(quad & 0xffffn).toString(16)}`;
  }
  const [head = "", rest] = groups.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const missing = rest === undefined ? 0 : 8 - left.length - right.length;
  const all = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  return all.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

/**
 * A bare IP literal, or `undefined`. Brackets are allowed around IPv6; a zone
 * (`%eth0`) or a port is not, so neither can be mistaken for part of an address.
 */
export function parseAddress(text: string): IpAddress | undefined {
  const bare = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  const family = isIP(bare);
  if (family === 4) return { family: 4, value: ipv4Value(bare) };
  if (family !== 6 || bare.includes("%")) return undefined;
  const value = ipv6Value(bare);
  return value >> 32n === IPV4_MAPPED_PREFIX >> 32n
    ? { family: 4, value: value & 0xffffffffn }
    : { family: 6, value };
}

/** An address, or an address and `/prefix`. An IPv4-mapped network is taken as IPv4. */
export function parseNetwork(text: string): IpNetwork | undefined {
  const [addressText = "", prefixText, extra] = text.split("/");
  if (extra !== undefined) return undefined;
  const address = parseAddress(addressText);
  if (address === undefined) return undefined;
  const written = isIP(addressText.replace(/^\[|\]$/g, "")) === 6 ? 128 : 32;
  let prefix = written;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return undefined;
    prefix = Number(prefixText);
    if (prefix > written) return undefined;
  }
  // Written as IPv6 but read as IPv4: the mapped prefix spends 96 bits.
  if (written === 128 && address.family === 4) {
    if (prefix < 96) return undefined;
    prefix -= 96;
  }
  return { ...address, prefix };
}

function mask(family: 4 | 6, prefix: number): bigint {
  const bits = BigInt(BITS[family]);
  return ((1n << bits) - 1n) ^ ((1n << (bits - BigInt(prefix))) - 1n);
}

export function contains(network: IpNetwork, address: IpAddress): boolean {
  if (network.family !== address.family) return false;
  const m = mask(network.family, network.prefix);
  return (network.value & m) === (address.value & m);
}

/** True when all of `inner` lies inside `outer`. */
export function within(inner: IpNetwork, outer: IpNetwork): boolean {
  return inner.prefix >= outer.prefix && contains(outer, inner);
}

function ipv4Text(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join(".");
}

/** A client's key: its IPv4 address, or its IPv6 /64. */
export function keyOf(address: IpAddress): string {
  if (address.family === 4) return ipv4Text(address.value);
  const top = address.value >> 64n;
  const groups = [48n, 32n, 16n, 0n].map((shift) => ((top >> shift) & 0xffffn).toString(16));
  return `${groups.join(":")}::/64`;
}

/** The ranges a trusted proxy may be in: loopback and private, nothing else. */
const TRUSTABLE: readonly IpNetwork[] = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1/128",
  "fc00::/7",
].map((text) => {
  const network = parseNetwork(text);
  if (network === undefined) throw new Error(`unreadable built-in range ${text}`);
  return network;
});

/** True when every address in `network` is loopback or private. */
export function isTrustable(network: IpNetwork): boolean {
  return TRUSTABLE.some((range) => within(network, range));
}

export interface ClientKey {
  readonly key: string;
  /** True when a trusted proxy named no readable client: the shared `unknown` bucket. */
  readonly unknown: boolean;
}

/**
 * The key a request counts against. `peer` is the socket's remote address;
 * `forwardedFor` is the `X-Forwarded-For` header as received, or undefined.
 */
export function clientKey(
  peer: string | undefined,
  forwardedFor: string | undefined,
  trustedProxies: readonly IpNetwork[],
): ClientKey {
  const unknown = { key: UNKNOWN_CLIENT, unknown: true };
  const socket = peer === undefined ? undefined : parseAddress(peer);
  if (socket === undefined) return unknown;
  if (!trustedProxies.some((proxy) => contains(proxy, socket))) {
    return { key: keyOf(socket), unknown: false };
  }
  const rightmost = forwardedFor?.split(",").at(-1)?.trim();
  const client = rightmost === undefined ? undefined : parseAddress(rightmost);
  return client === undefined ? unknown : { key: keyOf(client), unknown: false };
}
