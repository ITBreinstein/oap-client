/**
 * SSRF matrix C: which addresses the guard refuses — as a URL's host literal
 * (`isBlockedHost`, before any DNS), as a DNS answer (`guardedLookup`, at
 * connect time), and end to end, against a loopback stub that must see zero
 * connections.
 */

import type { LookupAddress } from "node:dns";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  guardedLookup,
  isBlockedAddress,
  isBlockedHost,
  type Resolver,
} from "../../src/address-guard.js";
import { forward } from "../../src/forward.js";
import { postExecute } from "../../src/upstream.js";
import { failure, never, publicEndpoint, stubServer, table, type Stub } from "./fixtures.js";

/** Every spelling here must be refused, whether it arrives as a literal or from DNS. */
const BLOCKED: readonly (readonly [string, readonly string[]])[] = [
  ["IPv4 loopback", ["127.0.0.1", "127.255.255.254"]],
  ["IPv4 this-network", ["0.0.0.0", "0.1.2.3"]],
  ["10/8", ["10.0.0.1", "10.255.255.255"]],
  ["172.16/12", ["172.16.0.1", "172.31.255.255"]],
  ["192.168/16", ["192.168.0.1", "192.168.255.255"]],
  ["100.64/10 (CGNAT)", ["100.64.0.1", "100.127.255.255"]],
  ["169.254/16 and the metadata address", ["169.254.0.1", "169.254.169.254"]],
  ["224/4 multicast", ["224.0.0.1", "239.255.255.255"]],
  ["240/4 reserved and broadcast", ["240.0.0.1", "255.255.255.255"]],
  ["IPv6 unspecified and loopback", ["::", "::1", "0:0:0:0:0:0:0:1"]],
  ["fc00::/7", ["fc00::1", "fd12:3456::1", "fd00:ec2::254"]],
  ["fe80::/10", ["fe80::1", "febf::1"]],
  [
    "IPv4-mapped IPv6",
    ["::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "0:0:0:0:0:ffff:a9fe:a9fe"],
  ],
  ["NAT64 wrapping a private IPv4", ["64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::a00:1"]],
  ["6to4 wrapping a private IPv4", ["2002:7f00:1::1", "2002:a9fe:a9fe::1", "2002:a00:1::1"]],
];

const EVERY_BLOCKED = BLOCKED.flatMap(([, addresses]) => addresses);

/** IPv4 in the spellings `inet_aton` accepts and `new URL()` normalises. All mean 127.0.0.1. */
const UNNORMALISED_LOOPBACK = [
  "127.1",
  "127.0.1",
  "2130706433",
  "0x7f000001",
  "0x7f.0.0.1",
  "0177.0.0.1",
  "017700000001",
];

const PUBLIC = ["93.184.215.14", "8.8.8.8", "172.15.255.255", "172.32.0.1", "2606:4700:4700::1111"];

describe("C — host literals, refused before any DNS", () => {
  it.each(BLOCKED)("%s", (_label, addresses) => {
    for (const address of addresses) expect(isBlockedHost(address), address).toBe(true);
  });

  it("bracketed IPv6, as URL.hostname spells it", () => {
    for (const host of ["[::1]", "[::]", "[fe80::1]", "[::ffff:7f00:1]", "[fd00:ec2::254]"]) {
      expect(new URL(`http://${host}/`).hostname).toBe(host);
      expect(isBlockedHost(host), host).toBe(true);
    }
  });

  it("names that only ever mean this machine or a metadata service", () => {
    for (const name of ["localhost", "LOCALHOST.", "api.localhost", "metadata.google.internal"]) {
      expect(isBlockedHost(name), name).toBe(true);
    }
  });

  it("un-normalised IPv4, once a URL has parsed it", () => {
    for (const spelling of UNNORMALISED_LOOPBACK) {
      const hostname = new URL(`http://${spelling}/`).hostname;
      expect(hostname, spelling).toBe("127.0.0.1");
      expect(isBlockedHost(hostname), spelling).toBe(true);
    }
  });

  it("un-normalised IPv4 as an address: refused, since it is not a parseable IP", () => {
    for (const spelling of UNNORMALISED_LOOPBACK)
      expect(isBlockedAddress(spelling), spelling).toBe(true);
  });

  // Refused before DNS: left to it, `getaddrinfo` would read these as
  // 127.0.0.1 and the connect-time check would refuse them there, but the
  // literal check must not rely on that.
  it.each(UNNORMALISED_LOOPBACK)("un-normalised IPv4 as a raw host literal: %s", (spelling) => {
    expect(isBlockedHost(spelling)).toBe(true);
  });

  it("a numeric host that is no valid IPv4 address fails closed", () => {
    for (const host of ["999.1.1.1", "1.2.3.4.5", "256.0.0.1", "0x100000000", "example.123"]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });

  it("control: public addresses and ordinary names pass the literal check", () => {
    for (const host of [...PUBLIC, "[2606:4700:4700::1111]", "ogc.example.org"]) {
      expect(isBlockedHost(host), host).toBe(false);
    }
  });

  it("control: a public address in another spelling, and names with digits in them, pass too", () => {
    for (const host of [
      "134744072",
      "8.8.8.8.",
      "0x8.0x8.0x8.0x8",
      "1.example",
      "ogc2.example.org",
      "123abc.example",
    ]) {
      expect(isBlockedHost(host), host).toBe(false);
    }
  });
});

function lookup(
  hostname: string,
  all: boolean,
  resolve: Resolver,
): Promise<{ error: NodeJS.ErrnoException | null; address: string | LookupAddress[] }> {
  return new Promise((done) => {
    guardedLookup(
      hostname,
      { all },
      (error, address) => {
        done({ error, address });
      },
      resolve,
    );
  });
}

describe("C — DNS answers, refused at connect time", () => {
  it.each(EVERY_BLOCKED)("a name resolving to %s", async (address) => {
    for (const all of [true, false]) {
      const result = await lookup("ogc.example", all, table({ "ogc.example": [address] }));
      expect(result.error?.code).toBe("ENOTFOUND");
      expect(result.address).toBe("");
    }
  });

  it.each([
    [["93.184.215.14", "8.8.8.8", "10.0.0.1"]],
    [["10.0.0.1", "93.184.215.14"]],
    [["93.184.215.14", "::1"]],
    [["2606:4700:4700::1111", "::ffff:169.254.169.254"]],
    [["fe80::1", "2606:4700:4700::1111", "93.184.215.14"]],
  ])("a name resolving to several addresses, any one blocked: %j", async (addresses) => {
    const result = await lookup("ogc.example", true, table({ "ogc.example": addresses }));
    expect(result.error?.code).toBe("ENOTFOUND");
  });

  it("control: public IPv4 and IPv6 answers are handed to the connector, all of them", async () => {
    const result = await lookup("ogc.example", true, table({ "ogc.example": PUBLIC }));
    expect(result.error).toBeNull();
    expect(result.address).toEqual(
      PUBLIC.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  });
});

describe("C — end to end: a blocked destination gets no connection", () => {
  let stub: Stub;
  beforeAll(async () => {
    stub = await stubServer();
  });
  afterEach(() => {
    stub.reset();
  });
  afterAll(async () => {
    await stub.close();
  });

  const limits = { timeoutMs: 5_000, maxResponseBytes: 1_024, schedule: never };
  /** Every one of these reaches the loopback stub if the guard lets it through. */
  const hosts = (): string[] => [
    "127.0.0.1",
    "127.1",
    "2130706433",
    "0x7f000001",
    "0177.0.0.1",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f00:1]",
    "loopback.example",
    "localhost",
  ];
  const dns = table({ "loopback.example": ["127.0.0.1"] });

  it("the read route refuses each, and the stub sees nothing", async () => {
    for (const host of hosts()) {
      const baseUrl = `http://${host}:${String(stub.port)}/ogc`;
      const reason = await failure(
        forward(
          publicEndpoint(baseUrl),
          { method: "GET", url: new URL(`${baseUrl}/processes`), headers: new Headers() },
          { ...limits, resolve: dns },
        ),
      );
      expect(reason, host).toBe("blocked-address");
    }
    expect(stub.connections).toBe(0);
  });

  it("the asynchronous execute refuses each, and the stub sees nothing", async () => {
    for (const host of hosts()) {
      const baseUrl = `http://${host}:${String(stub.port)}/ogc`;
      const reason = await failure(
        postExecute(publicEndpoint(baseUrl), "p", "{}", { ...limits, resolve: dns }),
      );
      expect(reason, host).toBe("blocked-address");
    }
    expect(stub.connections).toBe(0);
  });
});
