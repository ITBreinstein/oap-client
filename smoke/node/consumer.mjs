// Runs on bare Node against the *installed tarball*, not the workspace source.
// The assertion is simply that import and construction succeed: a Node-only or
// DOM-only API in the published bundle would throw before we get to the end.
import assert from "node:assert/strict";
import { createClient, ProcessesError, VERSION, classify, requireOk } from "@breinstein/oap-client";

assert.match(VERSION, /^\d+\.\d+\.\d+$/, "VERSION should be semver");

let seen;
const stubFetch = (input, init) => {
  seen = { input, init };
  return Promise.resolve(
    new Response('{"processes":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
};

const client = createClient({ baseUrl: "https://example.org/ogc", fetch: stubFetch });
assert.equal(
  client.baseUrl.href,
  "https://example.org/ogc/",
  "base URL should keep its last segment",
);

const env = await client.send("processes");
assert.equal(env.status, 200);
assert.equal(env.isJson, true);
assert.equal(
  seen.input,
  "https://example.org/ogc/processes",
  "path should resolve against the base",
);
// Read-once: both readers must work, in either order.
assert.deepEqual(await env.json(), { processes: [] });
assert.equal(await env.text(), '{"processes":[]}');

const ok = await classify(env);
assert.equal(ok.kind, "ok");
assert.equal(await requireOk(env), env);

// A 200 carrying a problem document is not ok. TextDecoder and URL both get
// exercised on the way to this assertion.
const failing = createClient({
  baseUrl: "https://example.org/ogc",
  fetch: () =>
    Promise.resolve(
      new Response(JSON.stringify({ type: "urn:x:nope", title: "Nope" }), {
        status: 200,
        headers: { "content-type": "application/problem+json" },
      }),
    ),
});
await assert.rejects(
  requireOk(await failing.send("processes")),
  (err) => err instanceof ProcessesError && err.problem.title === "Nope",
);

console.log(`  node smoke OK (core ${VERSION}, node ${process.version})`);
