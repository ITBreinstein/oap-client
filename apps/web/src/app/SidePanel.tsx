/**
 * A side panel: Examples, My jobs, About. A dialog while it is open (#35):
 * the page behind it is inert (`App` makes it so), so neither Tab nor a
 * click reaches it; Escape closes it from anywhere, and so does a click on
 * what it covers. One is open at a time (`App` decides).
 *
 * Opening moves focus to its heading; closing puts focus back where it was,
 * on the button that opened it, once the page is no longer inert. Closed, it
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
  /** Pinned to the panel's foot, outside what scrolls. */
  readonly footer?: ReactNode;
}

export function SidePanel(props: SidePanelProps) {
  const { id, title, open, onClose, className, children, footer } = props;
  const base = useId();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** What had focus when the panel opened: focus goes back there on closing. */
  const opener = useRef<HTMLElement | undefined>(undefined);
  /** Whether it was open last render, to tell a close from the first render. */
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body ? active : undefined;
      // Without scrolling: the panel is still sliding in from past the page's edge.
      heading.current?.focus({ preventScroll: true });
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // Closed, however: its button, Escape, a click beside it, a stage change.
    // Focus was in the panel, which is inert now and has let go of it. Back
    // to the opener, now the page is no longer inert; unless something else
    // took focus meanwhile (a new stage's heading, which comes after this).
    const back = opener.current;
    opener.current = undefined;
    const active = document.activeElement;
    if (active === null || active === document.body || root.current?.contains(active) === true) {
      back?.focus();
    }
  }, [open]);

  // Escape closes it wherever focus is: the page behind is inert, so focus is
  // in the panel or nowhere.
  useEffect(() => {
    if (!open || props.inert === true) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, props.inert, onClose]);

  return (
    // A div, not an aside: an aside may not be a dialog.
    <div
      ref={root}
      id={id}
      className={`side-panel${className === undefined ? "" : ` ${className}`}`}
      data-open={open}
      role="dialog"
      aria-modal={open ? true : undefined}
      aria-labelledby={`${base}-title`}
      inert={!open || props.inert === true}
    >
      <div className="side-panel-head">
        <h2 id={`${base}-title`} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button
          type="button"
          className="secondary panel-close"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
      <div className="side-panel-body">{children}</div>
      {footer !== undefined && <footer className="side-panel-foot">{footer}</footer>}
    </div>
  );
}
