/**
 * The SSRF address guard.
 *
 * The first three blocks are adapted from GeoLibre's
 * `tests/edge-proxy-redirect.test.ts` ("Vite proxy guard — validatePublicUrl"
 * and "assertResolvedPublicHost"), Copyright (c) 2026 Qiusheng Wu, MIT License —
 * the commit and the full notice are in THIRD_PARTY.md. The rest are ours:
 * the spellings a hand-written parser misses, and the lookup that pins the
 * connection to the addresses it validated.
 */

import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import {
  guardedLookup,
  isBlockedAddress,
  isBlockedHost,
  type LookupCallback,
  type Resolver,
} from "../src/address-guard.js";

describe("addresses GeoLibre's guard blocks", () => {
  it.each([
    ["loopback", ["127.0.0.1", "127.0.0.2", "127.255.255.255"]],
    ["RFC 1918", ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]],
    ["link-local and cloud metadata", ["169.254.169.254", "169.254.0.1"]],
    ["this network, multicast and reserved", ["0.0.0.0", "224.0.0.1", "255.255.255.255"]],
    [
      "CGNAT, benchmarking and the three TEST-NETs",
      [
        "100.64.0.1",
        "100.127.255.254",
        "198.18.0.1",
        "198.19.255.254",
        "192.0.2.1",
        "198.51.100.1",
        "203.0.113.1",
      ],
    ],
    [
      "IPv6 loopback, link-local and ULA",
      ["::1", "::", "fe80::1", "fe90::1", "febf::1", "fd00::1", "fc00::1"],
    ],
    ["IPv4-mapped IPv6", ["::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:10.0.0.1"]],
  ])("blocks %s", (_, addresses) => {
    for (const address of addresses) expect(isBlockedAddress(address), address).toBe(true);
  });

  it("allows public addresses, including 172.x outside 172.16/12", () => {
    for (const address of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks names that only ever mean this machine or a metadata service", () => {
    for (const host of ["localhost", "foo.localhost", "LOCALHOST.", "metadata.google.internal"]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
    expect(isBlockedHost("example.org")).toBe(false);
  });
});

describe("spellings and ranges beyond GeoLibre's list", () => {
  it.each([
    ["fully expanded IPv4-mapped", "0:0:0:0:0:ffff:0a00:0001"],
    ["hex IPv4-mapped", "::ffff:a00:1"],
    ["bracketed", "[::1]"],
    ["IPv4-compatible (deprecated)", "::127.0.0.1"],
    ["NAT64 embedding a private address", "64:ff9b::a00:1"],
    ["6to4 embedding a private address", "2002:a00:1::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["Teredo", "2001:0:4136:e378::1"],
    ["site-local", "fec0::1"],
    ["IPv6 multicast", "ff02::1"],
    ["AWS IPv6 metadata", "fd00:ec2::254"],
    ["Alibaba metadata", "100.100.100.200"],
  ])("blocks %s (%s)", (_, address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it("fails closed on anything that is not an IP literal", () => {
    for (const value of ["", "example.org", "999.1.1.1", "fe80::1%eth0", "1.2.3"]) {
      expect(isBlockedAddress(value), value).toBe(true);
    }
  });
});

/** A resolver that answers from a table, so the DNS branch runs offline. */
function table(answers: Record<string, readonly string[]>): Resolver {
  return (hostname, _options, callback) => {
    const addresses: LookupAddress[] = (answers[hostname] ?? []).map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    callback(null, addresses);
  };
}

function lookup(
  hostname: string,
  all: boolean,
  resolve: Resolver,
): Promise<{ error: NodeJS.ErrnoException | null; address: string | LookupAddress[] }> {
  return new Promise((resolvePromise) => {
    const callback: LookupCallback = (error, address) => {
      resolvePromise({ error, address });
    };
    guardedLookup(hostname, { all }, callback, resolve);
  });
}

describe("guardedLookup", () => {
  it("hands back a public name's addresses, in the shape the connector asked for", async () => {
    const resolve = table({
      "ogc.example": ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"],
    });

    const single = await lookup("ogc.example", false, resolve);
    expect(single).toEqual({ error: null, address: "93.184.215.14" });

    const all = await lookup("ogc.example", true, resolve);
    expect(all.error).toBeNull();
    expect(all.address).toHaveLength(2);
  });

  it("refuses a name that resolves to a private address — DNS rebinding", async () => {
    const result = await lookup("evil.example", true, table({ "evil.example": ["10.0.0.5"] }));
    expect(result.error?.code).toBe("ENOTFOUND");
    expect(result.error?.message).toMatch(/^refused:/);
  });

  it("refuses the whole name when any one answer is private, rather than filtering", async () => {
    const resolve = table({ "mixed.example": ["93.184.215.14", "169.254.169.254"] });
    const result = await lookup("mixed.example", true, resolve);
    expect(result.error?.message).toMatch(/^refused:/);
  });

  it("refuses an empty answer", async () => {
    const result = await lookup("empty.example", false, table({}));
    expect(result.error?.message).toMatch(/no addresses/);
  });

  it("refuses a blocked literal without asking DNS", async () => {
    let asked = false;
    const resolve: Resolver = (_hostname, _options, callback) => {
      asked = true;
      callback(null, []);
    };
    const result = await lookup("169.254.169.254", false, resolve);
    expect(result.error?.message).toMatch(/^refused:/);
    expect(asked).toBe(false);
  });
});
