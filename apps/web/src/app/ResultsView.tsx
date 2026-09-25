/**
 * The results (T10): each output separately. JSON pretty-printed and
 * collapsible, text as text — in a `<pre>`, never as markup — and everything
 * else as a download with its media type, file name and size. Every result can
 * be downloaded, shown or not.
 */

import { useId, useState } from "react";
import { saveBlob } from "./save.js";
import type { RenderableResult } from "../results/renderable.js";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadButton({ blob, filename }: { readonly blob: Blob; readonly filename: string }) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        saveBlob(blob, filename);
      }}
    >
      Download <span className="visually-hidden">{filename}</span>
    </button>
  );
}

function blobOf(result: RenderableResult): Blob {
  switch (result.kind) {
    case "json":
      return new Blob([JSON.stringify(result.value, null, 2)], { type: "application/json" });
    case "text":
      return new Blob([result.value], { type: result.mediaType });
    case "download":
      return result.blob;
  }
}

function filenameOf(result: RenderableResult, processId: string): string {
  switch (result.kind) {
    case "json":
      return `${processId}-${result.outputId}.json`;
    case "text":
      return `${processId}-${result.outputId}.txt`;
    case "download":
      return result.filename ?? `${processId}-${result.outputId}`;
  }
}

function ResultItem({
  result,
  processId,
}: {
  readonly result: RenderableResult;
  readonly processId: string;
}) {
  const [blob] = useState(() => blobOf(result));
  const filename = filenameOf(result, processId);
  return (
    <article className="result" data-output-id={result.outputId} data-kind={result.kind}>
      {result.kind === "json" && (
        <details open>
          <summary>
            <strong>{result.outputId}</strong> <span className="muted">JSON</span>
          </summary>
          <pre className="code">{JSON.stringify(result.value, null, 2)}</pre>
        </details>
      )}
      {result.kind === "text" && (
        <details open>
          <summary>
            <strong>{result.outputId}</strong> <span className="muted">{result.mediaType}</span>
          </summary>
          <pre className="code">{result.value}</pre>
        </details>
      )}
      {result.kind === "download" && (
        <p>
          <strong>{result.outputId}</strong>{" "}
          <span className="muted">
            {result.mediaType ?? "unknown type"}, {sizeLabel(result.blob.size)}
            {result.reason === "too-large" ? " — too large to show here" : ""}
          </span>
          <br />
          <span className="muted">{filename}</span>
        </p>
      )}
      <p className="actions">
        <DownloadButton blob={blob} filename={filename} />
      </p>
    </article>
  );
}

export function ResultsView({
  results,
  processId,
}: {
  readonly results: readonly RenderableResult[];
  readonly processId: string;
}) {
  const base = useId();
  return (
    <section aria-labelledby={`${base}-heading`} className="results">
      <h3 id={`${base}-heading`} tabIndex={-1} data-focus-on-stage>
        Result
      </h3>
      {results.length === 0 && <p>The server returned no outputs.</p>}
      {results.map((result, index) => (
        <ResultItem
          key={`${result.outputId}-${String(index)}`}
          result={result}
          processId={processId}
        />
      ))}
    </section>
  );
}
