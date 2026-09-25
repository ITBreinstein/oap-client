/**
 * The results (T10): each output separately. JSON pretty-printed and
 * collapsible, text as text — in a `<pre>`, never as markup — and everything
 * else as a download with its media type, file name and size. Every result can
 * be downloaded, shown or not. A result that is GeoJSON is also on the map
 * (`MapPane`), and says so. An image a browser can show is shown, and when a
 * bounding box beside it places it, it is on the map too, and both say so.
 */

import { useId, useState } from "react";
import { saveBlob } from "./save.js";
import { useDataUrl } from "./useDataUrl.js";
import { isShownImage, mapImage, plotStatus, type MapImage } from "../results/plottable.js";
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

function ImagePreview({ blob, outputId }: { readonly blob: Blob; readonly outputId: string }) {
  const url = useDataUrl(blob);
  return url === undefined ? null : (
    <img className="result-image" src={url} alt={`The image result “${outputId}”`} />
  );
}

function ResultItem({
  result,
  processId,
  placed,
}: {
  readonly result: RenderableResult;
  readonly processId: string;
  readonly placed: MapImage | undefined;
}) {
  const [blob] = useState(() => blobOf(result));
  const filename = filenameOf(result, processId);
  const plot = plotStatus(result).kind;
  const imageOnMap = placed?.outputId === result.outputId;
  const boxOfImage = placed?.bboxOutputId === result.outputId;
  return (
    <article
      className="result"
      data-output-id={result.outputId}
      data-kind={result.kind}
      data-plotted={plot === "plotted" || imageOnMap ? "true" : undefined}
    >
      {plot === "plotted" && <p className="muted">GeoJSON: shown on the map in blue.</p>}
      {imageOnMap && (
        <p className="muted">Shown on the map, over the area in “{placed.bboxOutputId}”.</p>
      )}
      {boxOfImage && <p className="muted">The area the image “{placed.outputId}” covers.</p>}
      {plot === "projected" && (
        <p className="muted">
          GeoJSON, but its coordinates are not longitude and latitude, so it is not shown on the
          map.
        </p>
      )}
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
      {result.kind === "download" && isShownImage(result) && (
        <ImagePreview blob={result.blob} outputId={result.outputId} />
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
  const placed = mapImage(results);
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
          placed={placed}
        />
      ))}
    </section>
  );
}
