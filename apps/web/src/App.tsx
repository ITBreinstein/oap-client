import {
  type ProcessDescription,
  VERSION,
  fetchJson,
  parseDescription,
} from "@breinstein/oap-client";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { ProcessInputs, defaultValues } from "./inputs/ProcessInputs.js";

/**
 * A process description URL to start from. Editable on the page: this is a
 * convenience for development, not a supported server. Nothing below it knows
 * which process it is looking at.
 */
const DEFAULT_URL = "http://localhost:5001/processes/bgt-land-cover-summary";

/**
 * Suggestions for the URL box, which stays free text — this is a datalist, not
 * a closed set of supported servers.
 *
 * The fixtures are addressed through the dev server's own `/fixtures` route
 * rather than Vite's `/@fs/` one, so no absolute path from a particular
 * machine ends up in the source of a public repository.
 */
function suggestions(): readonly { readonly url: string; readonly label: string }[] {
  const fixture = (name: string): { url: string; label: string } => ({
    url: `${window.location.origin}/fixtures/zoo-project/processes/${name}.json`,
    label: `${name} — captured ZOO-Project description`,
  });

  return [
    { url: DEFAULT_URL, label: "BGT land cover — live pygeoapi :5001" },
    {
      url: "http://localhost:5080/processes/hello-world",
      label: "hello-world — live pygeoapi :5080",
    },
    fixture("Buffer"),
    fixture("Centroid"),
    fixture("Ogr2Ogr"),
    fixture("echo"),
    fixture("longProcess"),
  ];
}

export function App(): ReactElement {
  const [url, setUrl] = useState(DEFAULT_URL);
  // `attempt` rather than the URL alone: pressing Load with the same URL still
  // has to re-run the effect, and a state value that never changes will not.
  const [request, setRequest] = useState({ url: DEFAULT_URL, attempt: 0 });
  const [process, setProcess] = useState<ProcessDescription | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    // Abort on unmount, and whenever a second load starts before the first
    // finishes — otherwise a slow earlier response can overwrite a newer one.
    const controller = new AbortController();

    fetchJson(request.url, { signal: controller.signal })
      .then((document) => {
        // The core parses JSON but vouches for nothing inside it, so the shape
        // check belongs here. `parseDescription` throws when the document is
        // not a process description at all — no `id`, or not an object — and
        // degrades everything survivable into warnings instead.
        const { process: described } = parseDescription(document.body, {
          // The URL the document was *served* from, so its links resolve
          // against the right base after a redirect or an `?f=json` retry.
          documentUrl: document.envelope.url,
        });
        setProcess(described);
        // Seed the schema defaults the controls are about to display, so the
        // form holds what it shows.
        setValues(defaultValues(described.inputs));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [request]);

  const handleChange = useCallback((id: string, value: unknown) => {
    setValues((previous) => ({ ...previous, [id]: value }));
  }, []);

  /** Clears everything held for the previous process, then asks for the next. */
  const load = useCallback((next: string) => {
    setError(undefined);
    setProcess(undefined);
    setValues({});
    setLoading(true);
    setRequest((previous) => ({ url: next, attempt: previous.attempt + 1 }));
  }, []);

  return (
    <main>
      <h1>Breinstein OGC API - Processes client</h1>
      <p data-testid="core-version">core {VERSION}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load(url);
        }}
      >
        <p>
          <label htmlFor="process-url">Process description URL</label>{" "}
          <input
            id="process-url"
            type="url"
            size={60}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />{" "}
          <button type="submit">Load</button>
        </p>
        <p>
          {/*
            A plain select rather than a datalist on the input above. A datalist
            filters its options against whatever is already typed, so a box
            holding a full URL matches exactly one of them and the list looks
            empty. This always shows everything.
          */}
          <label htmlFor="process-url-preset">or jump to</label>{" "}
          <select
            id="process-url-preset"
            value=""
            onChange={(event) => {
              setUrl(event.target.value);
              load(event.target.value);
            }}
          >
            <option value="" disabled>
              Choose a known service…
            </option>
            {suggestions().map((suggestion) => (
              <option key={suggestion.url} value={suggestion.url}>
                {suggestion.label}
              </option>
            ))}
          </select>
        </p>
      </form>

      {loading && <p data-testid="loading">Loading {request.url}…</p>}
      {error !== undefined && <p data-testid="error">{error}</p>}

      {process && (
        <section>
          {/* `id` is guaranteed: a document without one never parses. */}
          <h2>{process.title ?? process.id}</h2>
          {process.description !== undefined && <p>{process.description}</p>}

          {process.inputs.length > 0 ? (
            <ProcessInputs inputs={process.inputs} values={values} onChange={handleChange} />
          ) : (
            <p>This process description declares no inputs.</p>
          )}

          {/*
            What the form is currently holding. Keys whose value is `undefined`
            vanish from this dump, which is the point: an empty control means
            the input is absent, not that it is empty.
          */}
          <h3>Entered values</h3>
          <pre data-testid="entered-values">{JSON.stringify(values, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
