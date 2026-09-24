import type { Execution, ResponseEnvelope } from "@breinstein/oap-client";
import { type ReactElement, useEffect, useState } from "react";

/**
 * What came back.
 *
 * Raw only: a JSON view, or text. Choosing a presentation from the payload —
 * a map for GeoJSON, a table for CSV — is a separate job with its own evidence,
 * and guessing at it here would be the thing that guessing usually is.
 */

const PREVIEW_LIMIT = 20_000;

interface Loaded {
  readonly text: string;
  readonly truncated: boolean;
  readonly problem?: string;
}

async function readBody(envelope: ResponseEnvelope): Promise<Loaded> {
  if (envelope.bodyTooLarge) {
    return { text: "", truncated: false, problem: "The body is too large to show." };
  }

  // `isJson` is the server's claim, not a fact: ZOO returns GML under
  // `application/json`. Try to pretty-print, fall back to the text as sent.
  const text = await envelope.text();
  const body = envelope.isJson ? tryPretty(text) : text;

  return {
    text: body.slice(0, PREVIEW_LIMIT),
    truncated: body.length > PREVIEW_LIMIT,
    ...(envelope.isJson && body === text
      ? { problem: "Declared as JSON, but it does not parse as JSON." }
      : {}),
  };
}

function tryPretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function Immediate({ envelope }: { envelope: ResponseEnvelope }): ReactElement {
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);

  useEffect(() => {
    let live = true;
    // The envelope's readers are re-readable, so a re-render cannot consume it.
    readBody(envelope)
      .then((result) => {
        if (live) setLoaded(result);
      })
      .catch((cause: unknown) => {
        if (live) {
          setLoaded({
            text: "",
            truncated: false,
            problem: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      live = false;
    };
  }, [envelope]);

  return (
    <>
      <dl data-testid="result-meta">
        <dt>Status</dt>
        <dd>{envelope.status}</dd>
        <dt>Media type</dt>
        <dd>{envelope.mediaType ?? "not stated"}</dd>
        {/* Both are free, and both are half the evidence for a spatial result. */}
        {envelope.filename !== undefined && (
          <>
            <dt>Filename</dt>
            <dd>{envelope.filename}</dd>
          </>
        )}
        {envelope.contentCrs !== undefined && (
          <>
            <dt>Content-Crs</dt>
            <dd>{envelope.contentCrs}</dd>
          </>
        )}
        <dt>From</dt>
        <dd>{envelope.url}</dd>
      </dl>

      {loaded === undefined ? (
        <p>Reading the response…</p>
      ) : (
        <>
          {loaded.problem !== undefined && <p data-testid="result-problem">{loaded.problem}</p>}
          {loaded.text !== "" && (
            <pre data-testid="result-body">
              {loaded.text}
              {loaded.truncated ? "\n… truncated" : ""}
            </pre>
          )}
        </>
      )}
    </>
  );
}

function Job({ job }: { job: Execution & { kind: "job" } }): ReactElement {
  return (
    <>
      <p data-testid="result-job">
        The server turned this into a job rather than answering directly. Polling is not built yet,
        so this is where it stops for now.
      </p>
      <dl>
        <dt>Status URL</dt>
        <dd>{job.job.statusUrl}</dd>
        <dt>Job id</dt>
        <dd>{job.job.jobId ?? "not stated"}</dd>
        {/* A job found only through a body link is unreachable cross-origin
            unless the server exposes the Location header — a known finding. */}
        <dt>Found via</dt>
        <dd>{job.job.discoveredVia}</dd>
      </dl>
    </>
  );
}

export function ResultPanel({ execution }: { execution: Execution }): ReactElement {
  return (
    <section>
      <h3>Result</h3>
      {/* Asked for one mode and given the other is a fact about the server, and
          only recordable if both are on screen. */}
      <p data-testid="result-kind">
        {execution.kind === "immediate" ? "Answered directly" : "Accepted as a job"}, having asked
        for {execution.requestedMode}.
      </p>

      {execution.kind === "immediate" ? (
        <Immediate envelope={execution.response} />
      ) : (
        <Job job={execution} />
      )}
    </section>
  );
}
