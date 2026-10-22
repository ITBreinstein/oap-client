/**
 * The `properties` of a result feature the user clicked on the map (package
 * 5), beside the map rather than in a popup on it: the map binding knows
 * geometry, and this is data.
 *
 * Everything is text. A property value is whatever the server sent, so it is
 * rendered as a React text node — never as HTML, never parsed, and nothing
 * here uses `dangerouslySetInnerHTML`. A nested value is shown as formatted
 * JSON text. Nothing is styled by a property's value. For reading (#20): a
 * whole http(s) address is a link, a large number has its digits grouped,
 * and a short list is words separated by commas (`property-value.ts`).
 *
 * The panel sits on the side of the map away from the click, so it does not
 * cover the shape it is about, which the map outlines meanwhile.
 */

import { Fragment, useId } from "react";
import { isJsonObject } from "../forms/json.js";
import type { PlottedFeature } from "../results/plottable.js";
import { shownValue } from "./property-value.js";

/** One value: a link, words, or JSON text. */
function Value({ value }: { readonly value: unknown }) {
  const shown = shownValue(value);
  switch (shown.kind) {
    case "link":
      return (
        <a href={shown.href} target="_blank" rel="noopener noreferrer">
          {shown.href}
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      );
    case "text":
      return <>{shown.text}</>;
    case "json":
      return <pre className="code">{shown.text}</pre>;
  }
}

function Properties({ origin }: { readonly origin: PlottedFeature["origin"] }) {
  if (origin.kind === "bare-geometry") {
    return <p>This shape is a bare geometry, not a feature, so it has no properties.</p>;
  }
  const { properties } = origin;
  if (properties === null) return <p>This feature has no properties.</p>;
  if (!isJsonObject(properties)) {
    // GeoJSON wants an object or null here; show what came, as text.
    return (
      <>
        <p>This feature&apos;s properties are not an object:</p>
        <pre className="code">{JSON.stringify(properties, null, 2)}</pre>
      </>
    );
  }
  const entries = Object.entries(properties);
  if (entries.length === 0) return <p>This feature has no properties.</p>;
  return (
    <dl className="feature-properties-list">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd>
            <Value value={value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function FeatureProperties({
  feature,
  side = "left",
  onClose,
}: {
  readonly feature: PlottedFeature;
  /** Which side of the map: the one away from where the shape was clicked. */
  readonly side?: "left" | "right" | undefined;
  readonly onClose: () => void;
}) {
  const base = useId();
  return (
    <section
      className="map-overlay feature-properties"
      aria-labelledby={`${base}-heading`}
      data-testid="feature-properties"
      data-side={side}
    >
      <h3 id={`${base}-heading`}>Feature properties</h3>
      <p className="muted">From the result “{feature.outputId}”.</p>
      <Properties origin={feature.origin} />
      <p className="actions">
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </p>
    </section>
  );
}
