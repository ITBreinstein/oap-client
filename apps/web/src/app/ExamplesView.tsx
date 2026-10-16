/**
 * Examples, as the start screen shows them (up to four featured, and "Browse
 * all") and as the Examples panel lists them all: searched, filtered by what
 * they need, grouped by service. Choosing one connects to its service and
 * opens its process.
 */

import { useId, useState } from "react";
import type { Example } from "../config/runtime-config.js";
import {
  featuredExamples,
  filterExamples,
  groupByService,
  serviceLabel,
  type NeedsFilter,
} from "./examples.js";
import { NEEDS, NEEDS_LABELS } from "./needs.js";
import { NeedsTag } from "./NeedsTag.js";

function ExampleButton({
  example,
  disabled,
  onOpen,
  className,
}: {
  readonly example: Example;
  readonly disabled: boolean;
  readonly onOpen: (example: Example) => void;
  readonly className: string;
}) {
  const base = useId();
  return (
    <button
      type="button"
      className={className}
      // Named by its title alone; the rest is its description.
      aria-labelledby={`${base}-title`}
      aria-describedby={`${base}-more`}
      disabled={disabled}
      onClick={() => {
        onOpen(example);
      }}
    >
      <span className="example-title" id={`${base}-title`}>
        {example.title}
      </span>
      <span id={`${base}-more`} className="example-more">
        <span className="example-summary">{example.summary}</span>{" "}
        {example.needs !== undefined && <NeedsTag needs={example.needs} />}{" "}
        <span className="example-service mono">
          <span className="visually-hidden">on </span>
          {serviceLabel(example.service)}
        </span>{" "}
        <span className="example-id mono">
          <span className="visually-hidden">, process </span>
          {example.process}
        </span>
      </span>
    </button>
  );
}

export interface FeaturedExamplesProps {
  readonly examples: readonly Example[];
  /** While a connection is being made, nothing new can start. */
  readonly busy: boolean;
  readonly onOpen: (example: Example) => void;
  readonly onBrowse: () => void;
  /** Whether the Examples panel is open, for its button. */
  readonly browsing: boolean;
  readonly panelId: string;
}

/** The start screen's examples. Nothing at all when none are configured. */
export function FeaturedExamples(props: FeaturedExamplesProps) {
  const { examples, busy, onOpen, onBrowse, browsing, panelId } = props;
  const base = useId();
  if (examples.length === 0) return null;
  const featured = featuredExamples(examples);
  return (
    <section className="featured-examples" aria-labelledby={`${base}-heading`}>
      <div className="featured-head">
        <h3 id={`${base}-heading`}>Start from an example</h3>
        <button
          type="button"
          className="secondary browse-all"
          aria-expanded={browsing}
          aria-controls={panelId}
          onClick={onBrowse}
        >
          Browse all<span className="visually-hidden"> {String(examples.length)} examples</span>
          <span className="browse-arrow" aria-hidden="true">
            {" "}
            →
          </span>
        </button>
      </div>
      {featured.length > 0 && (
        <ul className="example-grid">
          {featured.map((example) => (
            <li key={`${example.service} ${example.process}`}>
              <ExampleButton
                example={example}
                disabled={busy}
                onOpen={onOpen}
                className="example-card"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const FILTERS: readonly NeedsFilter[] = ["all", ...NEEDS];

/** Every example: a search, a filter by what it needs, and the list by service. */
export function ExamplesBrowser({
  examples,
  busy,
  onOpen,
}: {
  readonly examples: readonly Example[];
  readonly busy: boolean;
  readonly onOpen: (example: Example) => void;
}) {
  const base = useId();
  const [query, setQuery] = useState("");
  const [needs, setNeeds] = useState<NeedsFilter>("all");
  const found = filterExamples(examples, query, needs);
  const groups = groupByService(found);

  return (
    <div className="examples-browser">
      <div className="examples-tools">
        <p className="search-field">
          <label htmlFor={`${base}-search`}>Search examples</label>
          <input
            id={`${base}-search`}
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Title, summary or process id…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </p>
        <div className="filters" role="group" aria-label="What it needs">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className="filter"
              aria-pressed={needs === filter}
              onClick={() => {
                setNeeds(filter);
              }}
            >
              {filter === "all" ? (
                "All"
              ) : (
                <>
                  <span className="needs" data-needs={filter} aria-hidden="true">
                    <span className="needs-mark" />
                  </span>
                  {NEEDS_LABELS[filter]}
                </>
              )}
            </button>
          ))}
        </div>
      </div>
      <p className="muted examples-count" role="status">
        {found.length === 1 ? "1 example" : `${String(found.length)} examples`}
      </p>
      {groups.map((group) => (
        <section
          key={group.service}
          className="example-group"
          aria-label={serviceLabel(group.service)}
        >
          <h3 className="example-group-head">
            <span className="mono">{serviceLabel(group.service)}</span>{" "}
            <span className="count">
              <span aria-hidden="true">· </span>
              {String(group.examples.length)}
            </span>
          </h3>
          <ul className="example-rows">
            {group.examples.map((example) => (
              <li key={example.process}>
                <ExampleButton
                  example={example}
                  disabled={busy}
                  onOpen={onOpen}
                  className="example-row"
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
