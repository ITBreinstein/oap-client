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
import { useContext, useId, useState } from "react";
import { CopyButton } from "./CopyButton.js";
import { MapLimitsContext } from "./map-limits.js";
import { ResultImage } from "./ResultImage.js";
import { saveBlob } from "./save.js";
import { useDataUrl } from "./useDataUrl.js";
import { useSpared } from "./developer.js";
import { useUpdated } from "./variant.js";
import {
  isShownImage,
  mapImage,
  plotStatus,
  shownImage,
  type MapImage,
} from "../results/plottable.js";
import { isOpenable, isTruncated, originOf, type LoadedReference } from "../results/reference.js";
import { parseCsv } from "../results/csv.js";
import { plainValue } from "../results/plain-value.js";
import {
  defaultFilename,
  isCsv,
  textFilename,
  type RenderableResult,
} from "../results/renderable.js";

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
      // The server's bytes, when there are any: re-encoding the decoded text
      // would change a body in any charset but UTF-8.
      return result.blob ?? new Blob([result.value], { type: result.mediaType });
    case "download":
      return result.blob;
  }
}

function filenameOf(result: ValueResult, processId: string): string {
  switch (result.kind) {
    case "json":
      return `${processId}-${result.outputId}.json`;
    case "text":
      return textFilename(processId, result.outputId, result.mediaType);
    case "download":
      return result.filename ?? `${processId}-${result.outputId}`;
  }
}

/** How many of a CSV's rows are shown; the download has them all. */
export const CSV_ROWS_SHOWN = 50;

/**
 * A CSV result as a table (#26): its first row as the heading, then the
 * first {@link CSV_ROWS_SHOWN} rows, and how many more the download holds.
 */
function CsvTable({
  rows,
  outputId,
}: {
  readonly rows: readonly (readonly string[])[];
  readonly outputId: string;
}) {
  const [head = [], ...body] = rows;
  const shown = body.slice(0, CSV_ROWS_SHOWN);
  const more = body.length - shown.length;
  return (
    <>
      <div className="csv-table" tabIndex={0} role="region" aria-label={`Table “${outputId}”`}>
        <table>
          <thead>
            <tr>
              {head.map((cell, index) => (
                <th key={index} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && (
        <p className="muted" data-testid="csv-more">
          and {more.toLocaleString("en")} more {more === 1 ? "row" : "rows"}; download for all.
        </p>
      )}
    </>
  );
}

function ImagePreview({ blob, outputId }: { readonly blob: Blob; readonly outputId: string }) {
  const url = useDataUrl(blob);
  return url === undefined ? null : <ResultImage src={url} outputId={outputId} />;
}

function ResultItem({
  result,
  processId,
  placed,
  several,
}: {
  readonly result: ValueResult;
  readonly processId: string;
  readonly placed: MapImage | undefined;
  /** More than one result: each one's Copy names its output. */
  readonly several: boolean;
}) {
  const [blob] = useState(() => blobOf(result));
  const filename = filenameOf(result, processId);
  // A CSV this page can read is a table; any other text, or a CSV it can't, is text.
  const [csvRows] = useState(() => {
    if (result.kind !== "text" || !isCsv(result.mediaType)) return undefined;
    const rows = parseCsv(result.value);
    return rows === undefined || rows.length === 0 ? undefined : rows;
  });
  const { maxCoordinates } = useContext(MapLimitsContext);
  // STYLE TRIAL: the updated Instrument lays JSON out with tabs, and offers Copy.
  const updated = useUpdated();
  const copyName = several ? `Copy ${result.outputId}` : "Copy result";
  const plain = updated && result.kind === "json" ? plainValue(result.value) : undefined;
  const status = plotStatus(result, maxCoordinates);
  const plot = status.kind;
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
      {status.kind === "too-many" && (
        <p className="muted" data-testid="too-many-to-draw">
          GeoJSON with {status.positions.toLocaleString("en")} coordinates, more than the{" "}
          {status.limit.toLocaleString("en")} this page draws, so it is not shown on the map.
          Download it to open it elsewhere.
        </p>
      )}
      {/* STYLE TRIAL (#27): one plain value is the answer itself, shown large. */}
      {plain !== undefined && (
        <div className="code-box result-value-box">
          <p className="result-value" data-plain-value="true">
            {String(plain)}
          </p>
          <CopyButton name={copyName} text={() => String(plain)} />
        </div>
      )}
      {result.kind === "json" && (
        // Folded when the map shows it: the shape is the answer there, and
        // pages of coordinates would push the next steps off screen. Folded
        // too beneath a plain value (#27).
        <details open={plot !== "plotted" && plain === undefined}>
          <summary>
            <strong>{result.outputId}</strong> <span className="muted">JSON</span>
          </summary>
          {updated ? (
            <div className="code-box">
              <pre className="code">{JSON.stringify(result.value, null, "\t")}</pre>
              <CopyButton
                // Beneath a plain value, which has "Copy result" of its own (#27).
                name={plain === undefined ? copyName : `${copyName} as JSON`}
                text={() => JSON.stringify(result.value, null, "\t")}
              />
            </div>
          ) : (
            <pre className="code">{JSON.stringify(result.value, null, 2)}</pre>
          )}
        </details>
      )}
      {result.kind === "text" && (
        <details open>
          <summary>
            <strong>{result.outputId}</strong> <span className="muted">{result.mediaType}</span>
          </summary>
          {csvRows !== undefined ? (
            updated ? (
              // STYLE TRIAL: Copy copies the CSV as the service sent it.
              <div className="code-box">
                <CsvTable rows={csvRows} outputId={result.outputId} />
                <CopyButton name={copyName} text={() => result.value} />
              </div>
            ) : (
              <CsvTable rows={csvRows} outputId={result.outputId} />
            )
          ) : updated ? (
            <div className="code-box">
              <pre className="code">{result.value}</pre>
              <CopyButton name={copyName} text={() => result.value} />
            </div>
          ) : (
            <pre className="code">{result.value}</pre>
          )}
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

/**
 * An image given by reference, shown as the browser shows any image (#28):
 * from its host directly, never read by this page. What it can't show is
 * said, with the way on: the link.
 */
function LinkedImage({
  href,
  outputId,
  onShown,
}: {
  readonly href: string;
  readonly outputId: string;
  readonly onShown?: (() => void) | undefined;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="notice">
      The browser could not show it as an image. Open the link to see it in a new tab.
    </p>
  ) : (
    <ResultImage
      src={href}
      outputId={outputId}
      referrerPolicy="no-referrer"
      onError={() => {
        setFailed(true);
      }}
      onShown={onShown}
    />
  );
}

function LoadedLine({
  loaded,
  href,
  outputId,
}: {
  readonly loaded: LoadedReference;
  readonly href: string;
  readonly outputId: string;
}) {
  const host = hostOf(href) ?? "the server";
  const spared = useSpared(useUpdated());
  // Once the browser shows it as an image (#28), what could not be read is no
  // longer an error: a plain line says what that means instead.
  const [shown, setShown] = useState(false);
  const shownAsImage = (
    <p className="hint shown-as-image" data-testid="shown-as-image">
      Shown as an image. This page can’t read the file itself, so it can’t be checked or drawn on
      the map.
      {/* STYLE TRIAL: spared in the updated Instrument, recorded all the same (#43). */}
      {!spared && " The attempt has been recorded."}
    </p>
  );
  const onShown = () => {
    setShown(true);
  };
  switch (loaded.outcome) {
    case "ok":
      return <LoadedOk loaded={loaded} host={host} />;
    case "cors-blocked":
      // An image is shown all the same (#28): a browser shows an image from
      // anywhere, though the page itself may not read it.
      return loaded.image === true ? (
        <>
          {shown ? (
            shownAsImage
          ) : (
            <p className="notice">
              This page could not read it: {host} sends no CORS headers for it, or could not be
              reached.
              {/* STYLE TRIAL: spared in the updated Instrument, recorded all the same (#43). */}
              {!spared && " The attempt has been recorded."}
            </p>
          )}
          <LinkedImage href={href} outputId={outputId} onShown={onShown} />
        </>
      ) : (
        <p className="notice">
          This page could not read it: {host} sends no CORS headers for it, or could not be reached.
          Open the link to see it in a new tab.
          {/* STYLE TRIAL: spared in the updated Instrument, recorded all the same (#43). */}
          {!spared && " The attempt has been recorded."}
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
      return loaded.image === true ? (
        <>
          {shown && shownAsImage}
          <LinkedImage href={href} outputId={outputId} onShown={onShown} />
        </>
      ) : (
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
  const { maxCoordinates } = useContext(MapLimitsContext);
  const status = plotStatus(result, maxCoordinates);
  const plot = status.kind;
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
        {loaded !== undefined && (
          <LoadedLine loaded={loaded} href={result.href} outputId={result.outputId} />
        )}
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
      {status.kind === "too-many" && (
        <p className="muted" data-testid="too-many-to-draw">
          GeoJSON with {status.positions.toLocaleString("en")} coordinates, more than the{" "}
          {status.limit.toLocaleString("en")} this page draws, so it is not shown on the map.
          Download it to open it elsewhere.
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
            several={results.length > 1}
          />
        ),
      )}
    </section>
  );
}
