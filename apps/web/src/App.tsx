import { VERSION, fetchJson } from "@breinstein/oap-client";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { type InputDescription, ProcessInputs, defaultValues } from "./inputs/ProcessInputs.js";

/**
 * A process description URL to start from. Editable on the page: this is a
 * convenience for development, not a supported server. Nothing below it knows
 * which process it is looking at.
 */
const DEFAULT_URL = "http://localhost:5001/processes/bgt-land-cover-summary";

interface ProcessDescription {
  readonly id?: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputs?: Readonly<Record<string, InputDescription>>;
}

/**
 * The body arrives as `unknown` on purpose — the core parses JSON but does not
 * vouch for its shape. A server can return valid JSON that is not a process
 * description at all, so check before trusting it.
 */
function asProcessDescription(body: unknown): ProcessDescription | undefined {
  // Every field is optional, so any object satisfies the type. The check that
  // earns its keep is the one above: a string or a number is not a description.
  if (typeof body !== "object" || body === null) return undefined;
  return body;
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
        const described = asProcessDescription(document.body);
        if (described === undefined) {
          setError("That URL returned JSON, but not a process description.");
          return;
        }
        setProcess(described);
        // Seed the schema defaults the controls are about to display, so the
        // form holds what it shows.
        setValues(described.inputs ? defaultValues(described.inputs) : {});
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
      </form>

      {loading && <p data-testid="loading">Loading {request.url}…</p>}
      {error !== undefined && <p data-testid="error">{error}</p>}

      {process && (
        <section>
          <h2>{process.title ?? process.id ?? "Process"}</h2>
          {process.description !== undefined && <p>{process.description}</p>}

          {process.inputs ? (
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
