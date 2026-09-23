// Start one asynchronous job with a `subscriber`, poll it to the end, and
// write down what happened — the request, the execute response verbatim, and
// every status seen. Pair with listener.mjs, which records the callbacks.
//
//   node infra/callbacks/probe-subscriber.mjs <pygeoapi|zoo> <success|failure>
//
// Environment:
//
//   HOOK     where the servers reach the listener
//            (default http://host.docker.internal:9911)
//   S_BASE, IP_BASE, F_BASE
//            override the base of successUri, inProgressUri, failedUri one
//            at a time — to a closed port, or to the listener's /hang/ or
//            /status500/ paths. The value `omit` leaves that URI out.
//   TAG      a label for the run, carried into the URIs and the output file
//
// Restart ZOO with `./infra/zoo/zoo.sh refresh` before measuring it: every job
// costs its worker pool about one worker (finding 0044).
//
// Findings 0047 and 0048 were measured with this on 2026-09-23.

import { writeFileSync } from "node:fs";

const [server, outcome] = process.argv.slice(2);
const TARGETS = {
  pygeoapi: {
    success: {
      url: "http://localhost:5080/processes/slow/execution",
      body: { inputs: { seconds: 8 } },
    },
    failure: {
      url: "http://localhost:5080/processes/slow/execution",
      body: { inputs: { seconds: -1 } },
    },
  },
  zoo: {
    success: {
      url: "http://localhost:5090/ogc-api/processes/longProcess/execution",
      body: { inputs: { sid: 1 }, outputs: { Result: { transmissionMode: "value" } } },
    },
    failure: {
      url: "http://localhost:5090/ogc-api/processes/failR/execution",
      body: { inputs: {}, outputs: {} },
    },
  },
};
const target = TARGETS[server]?.[outcome];
if (target === undefined) {
  console.error("usage: probe-subscriber.mjs <pygeoapi|zoo> <success|failure>");
  process.exit(2);
}

const hook = process.env.HOOK ?? "http://host.docker.internal:9911";
const run = `${server}-${outcome}-${process.env.TAG ?? "plain"}-${String(Date.now())}`;
const subscriber = {};
for (const [member, variable, leaf] of [
  ["successUri", "S_BASE", "success"],
  ["inProgressUri", "IP_BASE", "in-progress"],
  ["failedUri", "F_BASE", "failed"],
]) {
  const base = process.env[variable] ?? `${hook}/cb`;
  if (base !== "omit") subscriber[member] = `${base}/${run}/${leaf}`;
}

const record = { run, url: target.url, requestBody: { ...target.body, subscriber }, polls: [] };
const t0 = Date.now();
const response = await fetch(target.url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "respond-async",
  },
  body: JSON.stringify(record.requestBody),
  redirect: "manual",
});
record.execute = {
  status: response.status,
  headers: [...response.headers.entries()],
  location: response.headers.get("location"),
  body: await response.text(),
};
console.log(`${run}: ${String(response.status)} Location=${String(record.execute.location)}`);

const statusUrl = record.execute.location;
if (statusUrl !== null) {
  for (let i = 0; i < 90; i += 1) {
    const poll = await fetch(statusUrl, { headers: { Accept: "application/json" } });
    let document;
    try {
      document = JSON.parse(await poll.text());
    } catch {
      document = {};
    }
    record.polls.push({
      t: Date.now() - t0,
      http: poll.status,
      status: document.status,
      progress: document.progress,
    });
    if (["successful", "failed", "dismissed"].includes(document.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
// Callbacks can arrive after the terminal status, so wait for stragglers.
await new Promise((resolve) => setTimeout(resolve, 10_000));
writeFileSync(`run-${run}.json`, JSON.stringify(record, null, 2));
console.log(
  `${run}: ${record.polls.map((poll) => `${String(poll.t)}ms:${String(poll.status)}`).join(" ")}`,
);
