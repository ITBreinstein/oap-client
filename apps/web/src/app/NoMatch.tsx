/**
 * A search that finds nothing (#9): says so in words, in place of an empty
 * list, with the way back. Clearing hands the focus back to the search
 * field, since the button goes with the message.
 */

import type { RefObject } from "react";

export function NoMatch({
  noun,
  query,
  onClear,
  field,
}: {
  /** What is searched, plural: "processes", "examples". */
  readonly noun: string;
  readonly query: string;
  readonly onClear: () => void;
  readonly field: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="no-match">
      <p className="list-empty">
        No {noun} match “{query.trim()}”.
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          onClear();
          field.current?.focus();
        }}
      >
        Clear search
      </button>
    </div>
  );
}
