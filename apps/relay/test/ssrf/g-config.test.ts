/**
 * SSRF matrix G: what configuration the relay agrees to start with.
 *
 * Decided in the audit: a private-address allowance takes two keys. The
 * per-endpoint `allowPrivateNetwork` flag says which endpoint; the
 * `RELAY_ALLOW_PRIVATE_ADDRESSES=1` environment variable says this deployment
 * may have any such endpoint at all. Neither enables anything alone. Without
 * both, the relay refuses to start with an endpoint that is plain `http:`, a
 * loopback, private or metadata host, or carries userinfo.
 *
 * `parseConfig` takes the variable as `allowPrivateAddresses`; `loadStartup`
 * reads it from the environment, as `server.ts` does, and says what to warn.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../../src/config.js";
import { loadStartup } from "../../src/startup.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

const PRIVATE_BASES = [
  "http://ogc.example.org",
  "https://localhost",
  "https://api.localhost",
  "https://127.0.0.1",
  "https://127.1",
  "https://10.0.0.1/ogc",
  "https://192.168.1.10",
  "https://169.254.169.254",
  "https://[::1]",
  "https://[fd00::1]",
  "https://[::ffff:10.0.0.1]",
  "https://metadata.google.internal",
];

function withEndpoint(endpoint: Record<string, unknown>): unknown {
  return { endpoints: [{ key: "e", executeRoute: "relay", ...endpoint }] };
}

describe("G — without the allowance", () => {
  it("infra/relay/ci.json refuses to start", () => {
    expect(() => parseConfig(readJson("infra/relay/ci.json"))).toThrow(ConfigError);
  });

  it("an endpoint flagged allowPrivateNetwork refuses to start, even on a public https host", () => {
    expect(() =>
      parseConfig(withEndpoint({ baseUrl: "https://ogc.example.org", allowPrivateNetwork: true })),
    ).toThrow(ConfigError);
  });

  it.each(PRIVATE_BASES)("%s refuses to start", (baseUrl) => {
    expect(() => parseConfig(withEndpoint({ baseUrl }))).toThrow(ConfigError);
  });

  it.each(["https://user@ogc.example.org", "https://user:pw@ogc.example.org"])(
    "%s refuses to start",
    (baseUrl) => {
      expect(() => parseConfig(withEndpoint({ baseUrl }))).toThrow(ConfigError);
    },
  );

  it("control: the public demo template starts, with the guard on for every endpoint", () => {
    const config = parseConfig(readJson("infra/relay/demo.example.json"));
    expect(config.endpoints.length).toBeGreaterThan(0);
    for (const endpoint of config.endpoints) {
      expect(new URL(endpoint.baseUrl).protocol).toBe("https:");
      expect(endpoint.allowPrivateNetwork).toBe(false);
    }
  });
});

describe("G — the two keys", () => {
  const allowed = { allowPrivateAddresses: true };

  it("both turned: infra/relay/ci.json starts, with the guard off for its flagged endpoints only", () => {
    const config = parseConfig(readJson("infra/relay/ci.json"), allowed);
    expect(config.endpoints.map((endpoint) => endpoint.allowPrivateNetwork)).toEqual(
      config.endpoints.map(() => true),
    );
  });

  it.each(PRIVATE_BASES)("both turned: %s starts", (baseUrl) => {
    expect(
      parseConfig(withEndpoint({ baseUrl, allowPrivateNetwork: true }), allowed).endpoints[0]
        ?.allowPrivateNetwork,
    ).toBe(true);
  });

  it.each(PRIVATE_BASES)("the environment alone enables nothing: %s still refuses", (baseUrl) => {
    expect(() => parseConfig(withEndpoint({ baseUrl }), allowed)).toThrow(ConfigError);
  });

  it("the environment alone leaves a public endpoint's guard on", () => {
    const config = parseConfig(withEndpoint({ baseUrl: "https://ogc.example.org" }), allowed);
    expect(config.endpoints[0]?.allowPrivateNetwork).toBe(false);
  });

  it("userinfo refuses to start even with both", () => {
    expect(() =>
      parseConfig(
        withEndpoint({ baseUrl: "http://user:pw@localhost:5080", allowPrivateNetwork: true }),
        allowed,
      ),
    ).toThrow(ConfigError);
  });
});

describe("G — startup, from the environment", () => {
  const CI = "infra/relay/ci.json";
  const readFile = (path: string): string => readFileSync(join(ROOT, path), "utf8");

  it("infra/relay/ci.json without RELAY_ALLOW_PRIVATE_ADDRESSES refuses to start", () => {
    expect(() => loadStartup({ RELAY_CONFIG: CI }, readFile)).toThrow(ConfigError);
    expect(() => loadStartup({ RELAY_CONFIG: CI }, readFile)).toThrow(
      /RELAY_ALLOW_PRIVATE_ADDRESSES=1/,
    );
  });

  it.each(["", "0"])("RELAY_ALLOW_PRIVATE_ADDRESSES=%j is off", (value) => {
    expect(() =>
      loadStartup({ RELAY_CONFIG: CI, RELAY_ALLOW_PRIVATE_ADDRESSES: value }, readFile),
    ).toThrow(ConfigError);
  });

  it.each(["true", "yes", "01", " 1"])(
    "RELAY_ALLOW_PRIVATE_ADDRESSES=%j is a typo, and refuses to start",
    (value) => {
      expect(() =>
        loadStartup({ RELAY_CONFIG: CI, RELAY_ALLOW_PRIVATE_ADDRESSES: value }, readFile),
      ).toThrow(/RELAY_ALLOW_PRIVATE_ADDRESSES/);
    },
  );

  it("with it, ci.json starts, and the warning names every endpoint whose guard is off", () => {
    const { config, warnings } = loadStartup(
      { RELAY_CONFIG: CI, RELAY_ALLOW_PRIVATE_ADDRESSES: "1" },
      readFile,
    );
    expect(warnings).toHaveLength(1);
    const [warning] = warnings;
    expect(warning).toMatch(/WARNING/);
    expect(warning).toMatch(/OFF/);
    for (const endpoint of config.endpoints) expect(warning).toContain(endpoint.key);
  });

  it("with it but no flagged endpoint, it warns that it does nothing, and names none", () => {
    const { warnings } = loadStartup(
      { RELAY_CONFIG: "infra/relay/demo.example.json", RELAY_ALLOW_PRIVATE_ADDRESSES: "1" },
      readFile,
    );
    expect(warnings).toEqual([expect.stringMatching(/does nothing/)]);
  });

  it("control: the public demo template starts without it, and without a warning", () => {
    const { warnings } = loadStartup({ RELAY_CONFIG: "infra/relay/demo.example.json" }, readFile);
    expect(warnings).toEqual([]);
  });

  it("control: no config at all starts, with no endpoints", () => {
    expect(loadStartup({}, readFile).config.endpoints).toEqual([]);
  });
});

describe("G — deployment artefacts never grant the allowance", () => {
  const ALLOWANCE = "RELAY_ALLOW_PRIVATE_ADDRESSES";

  function composeFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.ya?ml$/.test(entry.name)) found.push(path);
      }
    };
    walk("infra");
    for (const entry of readdirSync(ROOT)) {
      if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(entry)) found.push(entry);
    }
    return found;
  }

  it("the relay's Dockerfile neither sets it nor ships the CI config", () => {
    const dockerfile = readFileSync(join(ROOT, "apps/relay/Dockerfile"), "utf8");
    expect(dockerfile).not.toContain(ALLOWANCE);
    expect(dockerfile).not.toContain("ci.json");
    expect(dockerfile).not.toContain("allowPrivateNetwork");
  });

  it("no compose file sets it", () => {
    const files = composeFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).not.toContain(ALLOWANCE);
    }
  });
});
