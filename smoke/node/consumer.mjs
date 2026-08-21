// Runs on bare Node against the *installed tarball*, not the workspace source.
// The assertion is simply that import and construction succeed: a Node-only or
// DOM-only API in the published bundle would throw before we get to the end.
import assert from "node:assert/strict";
import { createClient, OgcApiError, VERSION } from "@breinstein/ogcapi-processes-core";

assert.match(VERSION, /^\d+\.\d+\.\d+$/, "VERSION should be semver");

let seen;
const stubFetch = (input, init) => {
  seen = { input, init };
  return Promise.resolve(new Response("{}", { status: 200 }));
};

const client = createClient({ baseUrl: "https://example.org/ogc", fetch: stubFetch });
assert.equal(
  client.baseUrl.href,
  "https://example.org/ogc/",
  "base URL should keep its last segment",
);

const res = await client.request("processes");
assert.equal(res.status, 200);
assert.equal(
  seen.input,
  "https://example.org/ogc/processes",
  "path should resolve against the base",
);

assert.ok(new OgcApiError("boom", 500) instanceof Error);

console.log(`  node smoke OK (core ${VERSION}, node ${process.version})`);
