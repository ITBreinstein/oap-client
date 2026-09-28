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
 * The environment variable does not exist yet, so these tests call
 * `parseConfig` as startup does today — without it. The fix adds the variable
 * as an input, flips the expected failures below, and adds the two-key and
 * warning tests that need it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../../src/config.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

function withEndpoint(endpoint: Record<string, unknown>): unknown {
  return { endpoints: [{ key: "e", executeRoute: "relay", ...endpoint }] };
}

describe("G — without the allowance", () => {
  // Fails today: ci.json's endpoints carry `allowPrivateNetwork`, which alone
  // switches the guard off. Flips to `it` with the two-key fix.
  it.fails("infra/relay/ci.json refuses to start", () => {
    expect(() => parseConfig(readJson("infra/relay/ci.json"))).toThrow(ConfigError);
  });

  it.fails(
    "an endpoint flagged allowPrivateNetwork refuses to start, even on a public https host",
    () => {
      expect(() =>
        parseConfig(
          withEndpoint({ baseUrl: "https://ogc.example.org", allowPrivateNetwork: true }),
        ),
      ).toThrow(ConfigError);
    },
  );

  // Fails today: a loopback or private base starts, and then fails every
  // request with `blocked-address`. Plain `http:` starts and works.
  it.fails.each([
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
  ])("%s refuses to start", (baseUrl) => {
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
