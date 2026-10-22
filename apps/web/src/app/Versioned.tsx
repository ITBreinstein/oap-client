/**
 * STYLE TRIAL: words that differ between Instrument and its update. Both
 * are in the page; the stylesheets show one (`.when-current`,
 * `.when-updated`), so no component asks which version is on. Once one is
 * chosen, put its words in place of this and delete it (ADR 0002).
 */

import type { ReactNode } from "react";

export function Versioned({
  current,
  updated,
}: {
  readonly current: ReactNode;
  readonly updated: ReactNode;
}) {
  return (
    <>
      <span className="when-current">{current}</span>
      <span className="when-updated">{updated}</span>
    </>
  );
}
