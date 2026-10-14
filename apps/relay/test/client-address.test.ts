import { describe, expect, it } from "vitest";
import {
  clientKey,
  contains,
  isTrustable,
  keyOf,
  parseAddress,
  parseNetwork,
  UNKNOWN_CLIENT,
  type IpNetwork,
} from "../src/client-address.js";

function network(text: string): IpNetwork {
  const parsed = parseNetwork(text);
  if (parsed === undefined) throw new Error(`unreadable ${text}`);
  return parsed;
}

const PROXY = [network("172.17.0.1")];

describe("parseAddress", () => {
  it("reads IPv4, and IPv6 in its short, long and bracketed spellings", () => {
    expect(parseAddress("203.0.113.7")).toEqual({ family: 4, value: 0xcb007107n });
    const short = parseAddress("2001:db8::1");
    expect(short).toEqual(parseAddress("2001:0db8:0000:0000:0000:0000:0000:0001"));
    expect(short).toEqual(parseAddress("[2001:db8::1]"));
    expect(parseAddress("::")).toEqual({ family: 6, value: 0n });
  });

  it.each([
    ["::ffff:172.17.0.1"],
    ["::ffff:ac11:1"],
    ["0:0:0:0:0:ffff:172.17.0.1"],
    ["[::ffff:172.17.0.1]"],
  ])("takes the IPv4-mapped %s as the IPv4 address it carries", (text) => {
    expect(parseAddress(text)).toEqual(parseAddress("172.17.0.1"));
  });

  it.each([["fe80::1%eth0"], ["172.17.0.1:8787"], ["localhost"], [""], ["1.2.3"], ["unknown"]])(
    "refuses %j",
    (text) => {
      expect(parseAddress(text)).toBeUndefined();
    },
  );
});

describe("parseNetwork and contains", () => {
  it("matches inside a CIDR range and not outside it", () => {
    const range = network("192.168.87.0/24");
    expect(contains(range, { family: 4, value: 0xc0a857fen })).toBe(true); // .254
    const outside = parseAddress("192.168.88.1");
    if (outside === undefined) throw new Error("unreadable");
    expect(contains(range, outside)).toBe(false);
  });

  it("matches an IPv4-mapped peer against an IPv4 entry, and the other way round", () => {
    const peer = parseAddress("::ffff:172.17.0.1");
    if (peer === undefined) throw new Error("unreadable");
    expect(contains(network("172.17.0.1"), peer)).toBe(true);
    expect(network("::ffff:172.17.0.0/112")).toEqual(network("172.17.0.0/16"));
  });

  it("never matches across families", () => {
    const v6 = parseAddress("::1");
    if (v6 === undefined) throw new Error("unreadable");
    expect(contains(network("127.0.0.0/8"), v6)).toBe(false);
  });

  it.each([["10.0.0.0/33"], ["::/129"], ["10.0.0.0/8/8"], ["10.0.0.0/x"], ["::ffff:0:0/95"]])(
    "refuses %s",
    (text) => {
      expect(parseNetwork(text)).toBeUndefined();
    },
  );
});

describe("isTrustable", () => {
  it.each([
    ["127.0.0.1"],
    ["10.1.2.3"],
    ["172.17.0.1"],
    ["172.31.87.0/24"],
    ["192.168.0.0/16"],
    ["::1"],
    ["fd00::/8"],
    ["::ffff:172.17.0.1"],
  ])("accepts the loopback or private %s", (text) => {
    expect(isTrustable(network(text))).toBe(true);
  });

  it.each([
    ["0.0.0.0/0"],
    ["::/0"],
    ["8.8.8.8"],
    ["172.0.0.0/8"],
    ["169.254.169.254"],
    ["100.64.0.1"],
    ["fe80::1"],
    ["2001:db8::1"],
  ])("refuses %s, which is public, link-local, or wider than a private range", (text) => {
    expect(isTrustable(network(text))).toBe(false);
  });
});

describe("clientKey", () => {
  it("an untrusted peer is keyed by its own address, and its X-Forwarded-For ignored", () => {
    expect(clientKey("203.0.113.7", "1.2.3.4", PROXY)).toEqual({
      key: "203.0.113.7",
      unknown: false,
    });
    expect(clientKey("203.0.113.7", "1.2.3.4", [])).toEqual({
      key: "203.0.113.7",
      unknown: false,
    });
  });

  it("a trusted peer is keyed by the rightmost X-Forwarded-For entry, the one it wrote", () => {
    expect(clientKey("::ffff:172.17.0.1", "1.2.3.4, 198.51.100.9", PROXY).key).toBe("198.51.100.9");
    expect(clientKey("172.17.0.1", " 198.51.100.9 ", PROXY).key).toBe("198.51.100.9");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a name", "client.example"],
    ["with a port", "198.51.100.9:443"],
    ["ending in a comma", "198.51.100.9,"],
  ])("a trusted peer whose X-Forwarded-For is %s goes to the shared unknown bucket", (_, xff) => {
    expect(clientKey("172.17.0.1", xff, PROXY)).toEqual({ key: UNKNOWN_CLIENT, unknown: true });
  });

  it("keys IPv4-mapped peers as IPv4, so the two spellings are one client", () => {
    expect(clientKey("::ffff:203.0.113.7", undefined, []).key).toBe("203.0.113.7");
  });

  it("keys an IPv6 client by its /64", () => {
    const a = clientKey("2001:db8:1:2:aaaa::1", undefined, []).key;
    const b = clientKey("2001:db8:1:2:ffff:ffff:ffff:ffff", undefined, []).key;
    const c = clientKey("2001:db8:1:3::1", undefined, []).key;
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    const forwarded = clientKey("172.17.0.1", "2001:db8:1:2::9", PROXY);
    expect(forwarded.key).toBe(a);
  });

  it("an unreadable peer goes to the unknown bucket", () => {
    expect(clientKey(undefined, undefined, PROXY).key).toBe(UNKNOWN_CLIENT);
  });

  it("keyOf never prints more than the /64 of an IPv6 address", () => {
    const address = parseAddress("2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff");
    if (address === undefined) throw new Error("unreadable");
    expect(keyOf(address)).toBe("2001:db8:aaaa:bbbb::/64");
  });
});
