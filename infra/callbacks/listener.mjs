// A callback listener that writes down everything it is sent, verbatim.
//
// The instrument behind findings 0047 and 0048: point a subscriber's URIs at
// it and read back exactly which were called, in what order, with which
// headers and body. See infra/callbacks/README.md.
//
//   PORT=9911 OUT=callbacks.jsonl node infra/callbacks/listener.mjs
//
// Two paths misbehave on purpose, to see what a server does with a receiver
// that is not well:
//
//   …/status500/…   answers 500
//   …/hang/…        holds the request for 20 s before answering
//
// A receiver that is not there at all needs no code: point the URI at a port
// nothing listens on.

import { Buffer } from "node:buffer";
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 9911);
const out = process.env.OUT ?? "callbacks.jsonl";

createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks);
    const record = {
      at: new Date().toISOString(),
      method: request.method,
      url: request.url,
      httpVersion: request.httpVersion,
      // Raw, so header order and case survive: they are part of the evidence.
      rawHeaders: request.rawHeaders,
      bodyLength: body.length,
      body: body.toString("utf8"),
    };
    appendFileSync(out, `${JSON.stringify(record)}\n`);
    console.log(`${record.at} ${record.method} ${record.url} ${String(record.bodyLength)}B`);

    const reply = () => {
      response.writeHead(request.url.includes("/status500/") ? 500 : 200, {
        "Content-Length": "0",
      });
      response.end();
    };
    if (request.url.includes("/hang/")) setTimeout(reply, 20_000);
    else reply();
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`listening on :${String(port)}, writing ${out}`);
});
