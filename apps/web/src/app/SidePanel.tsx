/**
 * A side panel: Examples, My jobs. Not modal: the page beside it stays
 * usable. One is open at a time (`App` decides).
 *
 * Opening moves focus to its heading; Escape or the close button closes it
 * and puts focus back where it was, on the button that opened it. Closed, it
 * stays in the page, inert and out of sight, so what it holds keeps its state
 * (a confirmation half-way through, a search typed in) and slides back.
 *
 * Where it docks — the right edge, or out of the rail on the left — is each
 * style's to say, in CSS.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";

export interface SidePanelProps {
  readonly id: string;
  readonly title: string;
  readonly open: boolean;
  /** Set while a modal question is open: nothing in it can be reached. */
  readonly inert?: boolean | undefined;
  readonly onClose: () => void;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

export function SidePanel(props: SidePanelProps) {
  const { id, title, open, onClose, className, children } = props;
  const base = useId();
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** What had focus when the panel opened: focus goes back there on closing. */
  const opener = useRef<HTMLElement | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : undefined;
    // Without scrolling: the panel is still sliding in from past the page's edge.
    heading.current?.focus({ preventScroll: true });
  }, [open]);

  // Focus goes back before the panel turns inert, which would drop it on the
  // page's body. Closed from outside (its button again, another panel),
  // focus is already where the person put it.
  const close = () => {
    const back = opener.current;
    opener.current = undefined;
    if (root.current?.contains(document.activeElement) === true) back?.focus();
    onClose();
  };

  return (
    <aside
      ref={root}
      id={id}
      className={`side-panel${className === undefined ? "" : ` ${className}`}`}
      data-open={open}
      aria-labelledby={`${base}-title`}
      inert={!open || props.inert === true}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="side-panel-head">
        <h2 id={`${base}-title`} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button
          type="button"
          className="secondary panel-close"
          aria-label={`Close ${title}`}
          onClick={close}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
      <div className="side-panel-body">{children}</div>
    </aside>
  );
}
