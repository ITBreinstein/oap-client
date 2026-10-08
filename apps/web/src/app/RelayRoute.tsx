/**
 * The two visible halves of the read route (phase 3; finding 0050): the
 * question asked before anything goes through the relay, and the banner shown
 * the whole time something does.
 *
 * Both are part of the finding's visibility. The question is the only way onto
 * the route, and the banner cannot be dismissed.
 */

import { useEffect, useId, useLayoutEffect, useRef } from "react";

export interface RelayOfferProps {
  readonly onConfirm: () => void;
  /** Cancel, Escape, or anything else that closes the question. */
  readonly onDecline: () => void;
}

/**
 * A modal question. The page behind it is made inert by `App` while it is
 * open, so nothing there can be reached by keyboard or pointer (review W22),
 * and Escape is heard from anywhere on the page, not only from inside the
 * dialog: it used to be lost when pressed before focus had moved in.
 */
export function RelayOffer({ onConfirm, onDecline }: RelayOfferProps) {
  const base = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  // Focus the safe answer: nothing is sent through the relay unless the user
  // moves to "Use relay" and presses it.
  useEffect(() => {
    cancel.current?.focus();
  }, []);

  // A layout effect, so the listener is there before the question can be
  // seen. The offer follows a failed fetch, not a user event, and a passive
  // effect for it may run after the paint: an Escape in between was lost.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDecline();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onDecline]);

  return (
    <div className="modal-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${base}-title`}
        aria-describedby={`${base}-text`}
        data-testid="relay-offer"
      >
        <h2 id={`${base}-title`}>Use the relay?</h2>
        <p id={`${base}-text`}>
          This page could not read this server directly: it sends no CORS headers, or it could not
          be reached. Try it through the relay instead? This will be recorded as a finding.
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
