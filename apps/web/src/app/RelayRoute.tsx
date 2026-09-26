/**
 * The two visible halves of the read route (phase 3; finding 0050): the
 * question asked before anything goes through the relay, and the banner shown
 * the whole time something does.
 *
 * Both are part of the finding's visibility. The question is the only way onto
 * the route, and the banner cannot be dismissed.
 */

import { useEffect, useId, useRef, type KeyboardEvent } from "react";

export interface RelayOfferProps {
  readonly onConfirm: () => void;
  /** Cancel, Escape, or anything else that closes the question. */
  readonly onDecline: () => void;
}

export function RelayOffer({ onConfirm, onDecline }: RelayOfferProps) {
  const base = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  // Focus the safe answer: nothing is sent through the relay unless the user
  // moves to "Use relay" and presses it.
  useEffect(() => {
    cancel.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDecline();
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${base}-title`}
        aria-describedby={`${base}-text`}
        data-testid="relay-offer"
        onKeyDown={onKeyDown}
      >
        <h2 id={`${base}-title`}>Use the relay?</h2>
        <p id={`${base}-text`}>
          This server sent no CORS headers, so a web page cannot read it directly. Reach it through
          the relay instead? This will be recorded as a finding.
        </p>
        <p className="actions">
          <button type="button" onClick={onConfirm} data-testid="relay-confirm">
            Use relay
          </button>
          <button
            type="button"
            className="secondary"
            ref={cancel}
            onClick={onDecline}
            data-testid="relay-decline"
          >
            Cancel
          </button>
        </p>
      </div>
    </div>
  );
}

export function RelayBanner() {
  return (
    <p className="relay-banner" role="status" data-testid="relay-banner">
      Reached through the relay — this server does not allow direct access from a web page.
    </p>
  );
}
