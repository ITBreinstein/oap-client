/**
 * The `properties` of a result feature the user clicked on the map (package
 * 5), beside the map rather than in a popup on it: the map binding knows
 * geometry, and this is data.
 *
 * Everything is text. A property value is whatever the server sent, so it is
 * rendered as a React text node — never as HTML, never parsed, and nothing
 * here uses `dangerouslySetInnerHTML`. A nested value is shown as formatted
 * JSON text. Nothing is styled by a property's value.
 */

import { Fragment, useId } from "react";
import { isJsonObject } from "../forms/json.js";
import type { PlottedFeature } from "../results/plottable.js";

/** One value as text: a string as it is, anything else as JSON. */
function Value({ value }: { readonly value: unknown }) {
  if (typeof value === "string") return <>{value}</>;
  if (typeof value === "object" && value !== null) {
    return <pre className="code">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (typeof value === "number" || typeof value === "boolean") return <>{String(value)}</>;
  // What is left of JSON is null.
  return <>null</>;
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
  onClose,
}: {
  readonly feature: PlottedFeature;
  readonly onClose: () => void;
}) {
  const base = useId();
  return (
    <section
      className="map-overlay feature-properties"
      aria-labelledby={`${base}-heading`}
      data-testid="feature-properties"
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
