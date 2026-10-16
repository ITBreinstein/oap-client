/**
 * What a process needs, as one tag: a mark, with the words for screen
 * readers. Colour is never the only signal.
 */

import { NEEDS_LABELS, type Needs } from "./needs.js";

export function NeedsTag({ needs }: { readonly needs: Needs | undefined }) {
  if (needs === undefined) {
    return (
      <span className="needs needs-unknown">
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">Not known yet</span>
      </span>
    );
  }
  return (
    <span className="needs" data-needs={needs}>
      <span className="needs-mark" aria-hidden="true" />
      <span className="needs-text">{NEEDS_LABELS[needs]}</span>
    </span>
  );
}
