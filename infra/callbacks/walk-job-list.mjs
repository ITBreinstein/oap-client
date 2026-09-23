// Is a job pygeoapi just started reachable through its job list, and where?
//
// Starts a 30 s `slow` job, then walks every page of `GET /jobs` every 2 s for
// 60 s, following `next` exactly as served, and reports the page and position
// the job was found at on each walk. The experiment behind the 2026-09-23
// addenda to findings 0038 and 0039: the answer was "the first entry of the
// last page, every time, and never the first page".
//
//   node infra/callbacks/walk-job-list.mjs            # against :5080
//   BASE=http://localhost:5081 node infra/callbacks/walk-job-list.mjs

import { writeFileSync } from "node:fs";

const base = process.env.BASE ?? "http://localhost:5080";
const headers = { Accept: "application/json" };
let socketRetries = 0;

// pygeoapi (gunicorn) sometimes closes a kept-alive connection under Node's
// fetch; resend a GET once when it does. Counted, because it is an open issue.
async function get(url) {
  try {
    return await fetch(url, { headers });
  } catch (error) {
    if (error?.cause?.code !== "UND_ERR_SOCKET") throw error;
    socketRetries += 1;
    return fetch(url, { headers });
  }
}

async function walk() {
  const pages = [];
  let url = `${base}/jobs?f=json`;
  for (let i = 0; url !== undefined && i < 1_000; i += 1) {
    const document = await (await get(url)).json();
    pages.push({
      url,
      jobs: document.jobs.map((job) => ({
        id: job.jobID,
        status: job.status,
        started: job.started,
      })),
    });
    url = document.links?.find((link) => link.rel === "next")?.href;
  }
  return pages;
}

const before = await walk();
const t0 = Date.now();
const started = await fetch(`${base}/processes/slow/execution`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Prefer: "respond-async" },
  body: JSON.stringify({ inputs: { seconds: 30 } }),
});
const jobId = started.headers.get("location").split("/").pop();
console.log(
  `started ${jobId}; the list held ${String(before.flatMap((page) => page.jobs).length)} jobs`,
);

const samples = [];
while (Date.now() - t0 < 60_000) {
  const pages = await walk();
  let hit = null;
  pages.forEach((page, p) =>
    page.jobs.forEach((job, j) => {
      if (job.id === jobId) hit = { page: p + 1, position: j + 1, status: job.status };
    }),
  );
  const sample = { t: Date.now() - t0, pages: pages.length, hit, lastPage: pages.at(-1).url };
  samples.push(sample);
  console.log(
    `t+${String(sample.t).padStart(5)}ms pages=${String(sample.pages)} hit=${JSON.stringify(hit)}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

writeFileSync("walk-job-list.json", JSON.stringify({ jobId, samples }, null, 2));
console.log(`socket retries: ${String(socketRetries)}`);
