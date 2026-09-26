/**
 * The results (T10): each output separately. JSON pretty-printed and
 * collapsible, text as text — in a `<pre>`, never as markup — and everything
 * else as a download with its media type, file name and size. Every result can
 * be downloaded, shown or not. A result that is GeoJSON is also on the map
 * (`MapPane`), and says so. An image a browser can show is shown, and when a
 * bounding box beside it places it, it is on the map too, and both say so.
 *
 * An output given by reference (Task 8) is a link: where it points, a "Load"
 * button that is the only thing that ever fetches it, and a way to open it in
 * a new tab. What Load finds is shown by the same rules, and whatever went
 * wrong is said — an error page as text, never rendered.
 */

import { DEFAULT_MAX_BUFFER_BYTES } from "@breinstein/oap-client";
import { useId, useState } from "react";
import { saveBlob } from "./save.js";
import { useDataUrl } from "./useDataUrl.js";
import {
  isShownImage,
  mapImage,
  plotStatus,
  shownImage,
  type MapImage,
} from "../results/plottable.js";
import { isOpenable, isTruncated, originOf, type LoadedReference } from "../results/reference.js";
import { defaultFilename, type RenderableResult } from "../results/renderable.js";

type ValueResult = Exclude<RenderableResult, { kind: "reference" }>;
type ReferenceResult = Extract<RenderableResult, { kind: "reference" }>;

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

function blobOf(result: ValueResult): Blob {
  switch (result.kind) {
    case "json":
      return new Blob([JSON.stringify(result.value, null, 2)], { type: "application/json" });
    case "text":
      return new Blob([result.value], { type: result.mediaType });
    case "download":
      return result.blob;
  }
}

function filenameOf(result: ValueResult, processId: string): string {
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
  readonly result: ValueResult;
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

function hostOf(href: string): string | undefined {
  const origin = originOf(href);
  return origin === undefined ? undefined : new URL(origin).host;
}

/** Task 8, T6: never a silent first page. */
function pageLine(loaded: LoadedReference): string | undefined {
  const { page } = loaded;
  if (page === undefined || !isTruncated(page)) return undefined;
  const returned = page.returned === undefined ? "" : ` ${String(page.returned)}`;
  if (page.matched !== undefined && page.returned !== undefined && page.matched > page.returned) {
    return `Showing ${String(page.returned)} of ${String(page.matched)} features.`;
  }
  return `First page only:${returned} features. The server has more; this page loads one page.`;
}

function LoadedOk({ loaded, host }: { readonly loaded: LoadedReference; readonly host: string }) {
  const type = loaded.mediaType ?? "no media type";
  const size = loaded.blob === undefined ? "" : `, ${sizeLabel(loaded.blob.size)}`;
  switch (loaded.representation) {
    case "geojson":
      return (
        <p>
          Loaded: GeoJSON ({type}
          {size}).
        </p>
      );
    case "collection":
      return (
        <p>
          Loaded: a collection. Its GeoJSON items were read from{" "}
          {loaded.itemsUrl === undefined ? host : (hostOf(loaded.itemsUrl) ?? host)}.
        </p>
      );
    case "image":
      return (
        <p>
          Loaded: an image ({type}
          {size}).
        </p>
      );
    case "other":
    case undefined:
      return (
        <p>
          Loaded: {type}
          {size}. Not something this page shows; download it or open the link.
        </p>
      );
  }
}

function LoadedLine({ loaded, href }: { readonly loaded: LoadedReference; readonly href: string }) {
  const host = hostOf(href) ?? "the server";
  switch (loaded.outcome) {
    case "ok":
      return <LoadedOk loaded={loaded} host={host} />;
    case "cors-blocked":
      return (
        <p className="notice">
          This page may not read it: {host} sends no CORS headers for it. Open the link to see it in
          a new tab. The attempt has been recorded.
        </p>
      );
    case "http-error":
      return (
        <div className="notice">
          <p>
            {host} answered HTTP {String(loaded.status)}.
          </p>
          {loaded.detail !== undefined && <pre className="code">{loaded.detail}</pre>}
        </div>
      );
    case "too-large":
      return (
        <p className="notice">
          It is larger than the {(DEFAULT_MAX_BUFFER_BYTES / (1024 * 1024)).toFixed(0)} MB this page
          reads, so reading stopped and nothing of it was kept. Open the link to get it in a new
          tab.
        </p>
      );
    case "mixed-content":
      return (
        <p className="notice">
          This page is served over HTTPS and the link is plain HTTP, so the browser would block it.
          Open it in a new tab instead.
        </p>
      );
    case "unsupported-scheme":
      return (
        <p className="notice">Not an http or https address, so it is not fetched or opened.</p>
      );
    case "failed":
      return (
        <p className="notice">
          It could not be read{loaded.detail === undefined ? "" : ` (${loaded.detail})`}.
        </p>
      );
  }
}

function ReferenceItem({
  result,
  processId,
  placed,
  onLoad,
}: {
  readonly result: ReferenceResult;
  readonly processId: string;
  readonly placed: MapImage | undefined;
  readonly onLoad: (outputId: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const { loaded } = result;
  const host = hostOf(result.href);
  const plot = plotStatus(result).kind;
  const image = shownImage(result);
  const imageOnMap = placed?.outputId === result.outputId;
  const page = loaded === undefined ? undefined : pageLine(loaded);
  return (
    <article
      className="result"
      data-output-id={result.outputId}
      data-kind="reference"
      data-reference-outcome={loaded?.outcome}
      data-plotted={plot === "plotted" || imageOnMap ? "true" : undefined}
    >
      <p>
        <strong>{result.outputId}</strong>{" "}
        <span className="muted">
          a link, {result.mediaType ?? "type not given"}
          {host === undefined ? "" : `, on ${host}`}
        </span>
        {result.title !== undefined && (
          <>
            <br />
            <span className="muted">{result.title}</span>
          </>
        )}
      </p>
      <p>
        <code className="reference-href">{result.href}</code>
      </p>
      {loaded === undefined && host !== undefined && (
        <p className="muted">
          Not loaded. Loading fetches it from {host}, which then sees this computer&apos;s address.
        </p>
      )}
      <div role="status" aria-live="polite">
        {loaded !== undefined && <LoadedLine loaded={loaded} href={result.href} />}
      </div>
      {plot === "plotted" && <p className="muted">GeoJSON: shown on the map in blue.</p>}
      {plot === "plotted" && loaded?.axes === "swapped" && (
        <p className="muted">
          Its Content-Crs is EPSG:4326, latitude first: its axes were swapped to put it on the map.
        </p>
      )}
      {plot === "projected" && (
        <p className="muted">
          GeoJSON, but not in longitude and latitude
          {loaded?.contentCrs === undefined ? "" : ` (Content-Crs ${loaded.contentCrs})`}, so it is
          not shown on the map. Nothing here reprojects.
        </p>
      )}
      {page !== undefined && <p data-truncated="true">{page}</p>}
      {image !== undefined && <ImagePreview blob={image} outputId={result.outputId} />}
      {imageOnMap && (
        <p className="muted">Shown on the map, over the area in “{placed.bboxOutputId}”.</p>
      )}
      <p className="actions">
        {loaded === undefined && (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void onLoad(result.outputId).finally(() => {
                setLoading(false);
              });
            }}
          >
            {loading ? "Loading…" : "Load"}
          </button>
        )}{" "}
        {isOpenable(result.href) && (
          <a href={result.href} target="_blank" rel="noopener noreferrer">
            Open the link
          </a>
        )}{" "}
        {loaded?.blob !== undefined && (
          <DownloadButton
            blob={loaded.blob}
            filename={defaultFilename(processId, result.outputId, loaded.blob.type || undefined)}
          />
        )}
      </p>
    </article>
  );
}

export function ResultsView({
  results,
  processId,
  onLoad,
}: {
  readonly results: readonly RenderableResult[];
  readonly processId: string;
  readonly onLoad: (outputId: string) => Promise<void>;
}) {
  const base = useId();
  const placed = mapImage(results);
  return (
    <section aria-labelledby={`${base}-heading`} className="results">
      <h3 id={`${base}-heading`} tabIndex={-1} data-focus-on-stage>
        Result
      </h3>
      {results.length === 0 && <p>The server returned no outputs.</p>}
      {results.map((result, index) =>
        result.kind === "reference" ? (
          <ReferenceItem
            key={`${result.outputId}-${String(index)}`}
            result={result}
            processId={processId}
            placed={placed}
            onLoad={onLoad}
          />
        ) : (
          <ResultItem
            key={`${result.outputId}-${String(index)}`}
            result={result}
            processId={processId}
            placed={placed}
          />
        ),
      )}
    </section>
  );
}
