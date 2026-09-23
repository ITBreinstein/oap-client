/**
 * Which network addresses the relay may connect to.
 *
 * The first line of defence is the exact endpoint allowlist in the config: the
 * relay never builds a request URL from anything the browser sent except a
 * validated process id. This module is the second line, for the case the
 * allowlist cannot see — an allowlisted **name** that resolves, today or after
 * a DNS change, to a loopback, private, link-local or metadata address.
 *
 * Every address a name resolves to is checked, and the check happens inside
 * the connection's own `lookup`, so the address that was validated is the
 * address that is dialled. A pre-flight resolve followed by a separate connect
 * leaves a window for DNS rebinding; this does not.
 *
 * Adapted from GeoLibre's Vite proxy guard, Copyright (c) 2026 Qiusheng Wu,
 * MIT License — the commit and the full notice are in THIRD_PARTY.md. The range list and the lookup's reply-shape handling are
 * GeoLibre's; the classification is rebuilt on `net.BlockList`, which parses
 * every IPv6 spelling (including the fully expanded IPv4-mapped form a
 * hand-written parser misses), and the list gains the NAT64, 6to4,
 * documentation and multicast ranges it did not have.
 */

import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();

/** [network, prefix length, what it is]. */
const IPV4_BLOCKED: readonly (readonly [string, number, string])[] = [
  ["0.0.0.0", 8, "this network"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier-grade NAT, and Alibaba Cloud metadata"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local, and the AWS/GCP/Azure metadata address"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation (TEST-NET-1)"],
  ["192.88.99.0", 24, "6to4 relay anycast"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation (TEST-NET-2)"],
  ["203.0.113.0", 24, "documentation (TEST-NET-3)"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved, and limited broadcast"],
];

const IPV6_BLOCKED: readonly (readonly [string, number, string])[] = [
  ["::", 96, "unspecified, loopback, and IPv4-compatible"],
  ["64:ff9b::", 96, "NAT64 — embeds an IPv4 address that may be private"],
  ["64:ff9b:1::", 48, "local-use NAT64"],
  ["100::", 64, "discard"],
  ["2001::", 23, "IETF protocol assignments, including Teredo"],
  ["2001:db8::", 32, "documentation"],
  ["2002::", 16, "6to4 — embeds an IPv4 address that may be private"],
  ["fc00::", 7, "unique local, and the AWS IPv6 metadata address"],
  ["fe80::", 10, "link-local"],
  ["fec0::", 10, "site-local (deprecated)"],
  ["ff00::", 8, "multicast"],
];

for (const [network, prefix] of IPV4_BLOCKED) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of IPV6_BLOCKED) blocked.addSubnet(network, prefix, "ipv6");

/** Hostnames refused before any DNS is asked. */
function isBlockedName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "metadata.google.internal" ||
    name === "metadata"
  );
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * True when `address` must not be connected to. Fails closed: anything that is
 * not a parseable IP literal is blocked, including a scoped IPv6 address.
 *
 * `BlockList` matches IPv4-mapped IPv6 (`::ffff:10.0.0.1`, and its hex and
 * fully expanded spellings) against the IPv4 rules, which is the case that
 * lets a private address through a check written only for dotted quads.
 */
export function isBlockedAddress(address: string): boolean {
  const bare = stripBrackets(address);
  const family = isIP(bare);
  if (family === 0) return true;
  try {
    return blocked.check(bare, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return true;
  }
}

/**
 * True when `host` — a URL's hostname — is refused without resolving it: a
 * blocked IP literal, or a name that only ever means this machine or a cloud
 * metadata service. A name that is not refused here still has every address
 * it resolves to checked by {@link guardedLookup}.
 */
export function isBlockedHost(host: string): boolean {
  const bare = stripBrackets(host);
  if (isIP(bare) !== 0) return isBlockedAddress(bare);
  return isBlockedName(bare);
}

/** The single-address or all-addresses reply `net.connect`'s lookup expects. */
export type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** The resolver the guard wraps. `dns.lookup` in production; a stub in tests. */
export type Resolver = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolver: Resolver = (hostname, options, callback) => {
  dnsLookup(hostname, options, callback);
};

function refusal(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  // ENOTFOUND, not a custom code: the socket reports it as a resolution
  // failure, which is what it is from the caller's point of view.
  error.code = "ENOTFOUND";
  return error;
}

/**
 * A `lookup` for `http.request` that resolves every address, refuses the whole
 * name if any one of them is blocked, and only then hands the connector the
 * validated list.
 *
 * Refusing on *any* blocked answer rather than filtering it out is deliberate:
 * a name that resolves to both a public and a private address is either
 * misconfigured or being used against us, and neither is a reason to connect.
 *
 * Always resolves in all-addresses mode, so the connector cannot be downgraded
 * to one unchecked answer, but replies in whichever shape the connector asked
 * for — Node 20+ `net` asks for `all: true` (autoSelectFamily) and indexes into
 * the array, and answering that with the three-argument form fails.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
  resolve: Resolver = systemResolver,
): void {
  if (isBlockedHost(hostname)) {
    callback(refusal(`refused: ${hostname} is a blocked host`), "", 4);
    return;
  }
  resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error !== null) {
      callback(error, "", 4);
      return;
    }
    const first = addresses[0];
    if (first === undefined) {
      callback(refusal(`refused: ${hostname} resolved to no addresses`), "", 4);
      return;
    }
    for (const entry of addresses) {
      if (isBlockedAddress(entry.address)) {
        callback(refusal(`refused: ${hostname} resolves to a blocked address`), "", 4);
        return;
      }
    }
    if (options.all === true) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}
