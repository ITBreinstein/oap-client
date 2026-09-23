// What does pygeoapi do with a callback receiver that enforces a size limit?
//
// A relay must cap the bodies it accepts, and pygeoapi's success callback
// carries the whole process output. If refusing a large body resets the
// connection, and pygeoapi treats a reset like an unreachable receiver, the
// cap would turn successful jobs into failed ones (finding 0047).
//
//   node infra/callbacks/limit-listener.mjs      # :9913
//
// Paths:
//
//   /abrupt/…   over 64 KiB: answer 413 and destroy the socket unread
//   /drain/…    over 64 KiB: read and discard the body, then answer 413
//
// Measured 2026-09-23 with a 1 MiB output: the job stayed `successful` with
// both. Larger bodies were not tried.

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const LIMIT = 64 * 1024;

createServer((request, response) => {
  const length = Number(request.headers["content-length"] ?? 0);
  appendFileSync(
    "limit.jsonl",
    `${JSON.stringify({ at: new Date().toISOString(), url: request.url, contentLength: length })}\n`,
  );
  if (length > LIMIT && request.url.includes("/abrupt/")) {
    response.writeHead(413, { Connection: "close", "Content-Length": "0" });
    response.end();
    request.socket.destroy();
    return;
  }
  request.on("data", () => undefined);
  request.on("end", () => {
    response.writeHead(length > LIMIT ? 413 : 200, { "Content-Length": "0" });
    response.end();
  });
}).listen(9913, "0.0.0.0", () => {
  console.log("listening on :9913");
});
