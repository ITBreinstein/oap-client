/**
 * What a process needs, as one tag: a mark, with the words for screen
 * readers. Colour is never the only signal.
 *
 * STYLE TRIAL (#8): the updated Instrument also shows a short word beside the
 * mark, and nothing at all where it is not known yet, never a dash. A screen
 * reader hears the same words in both.
 */

import { NEEDS_LABELS, NEEDS_SHORT, type Needs } from "./needs.js";
import { useUpdated } from "./variant.js";

export function NeedsTag({ needs }: { readonly needs: Needs | undefined }) {
  const updated = useUpdated();
  if (needs === undefined) {
    return (
      <span className="needs needs-unknown">
        {!updated && <span aria-hidden="true">—</span>}
        <span className="visually-hidden">Not known yet</span>
      </span>
    );
  }
  return (
    <span className="needs" data-needs={needs}>
      <span className="needs-mark" aria-hidden="true" />
      <span className="needs-text">{NEEDS_LABELS[needs]}</span>
      {updated && (
        <span className="needs-short" aria-hidden="true">
          {NEEDS_SHORT[needs]}
        </span>
      )}
    </span>
  );
}
