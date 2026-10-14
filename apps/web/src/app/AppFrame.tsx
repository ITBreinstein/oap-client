/**
 * The app's frame: the one place that asks which style is on (ADR 0002).
 * Everything else differs between styles in CSS only.
 *
 * - Soft-precise hybrid and precise: a header across the top, with the title
 *   and the page's tools at its end.
 * - Instrument: a rail down the left edge (a bar along the bottom on a narrow
 *   screen), with one item per place in the workflow and the page's tools.
 *
 * Both carry the same title, the core's version and the same tools, so
 * nothing a test or a screen reader relies on depends on the style.
 */

import { VERSION } from "@breinstein/oap-client";
import type { ReactNode } from "react";
import type { StyleName } from "./appearance.js";

/** Where in the workflow the page is, for the rail's current item. */
export type FramePlace = "connect" | "processes" | "process";

export interface AppFrameProps {
  readonly style: StyleName;
  /** Set while a modal question is open: nothing in the frame can be reached. */
  readonly inert: boolean;
  /** The Appearance control. */
  readonly appearance: ReactNode;
  /** Tools beside it in the header, before it: My jobs. */
  readonly tools?: ReactNode;
  /** STYLE TRIAL (instrument): what the rail needs. */
  readonly place: FramePlace;
  /** Back to the start screen; undefined where it cannot be left (a run under way). */
  readonly onConnect: (() => void) | undefined;
  /** Back to the list; undefined before connecting, or while a run is under way. */
  readonly onProcesses: (() => void) | undefined;
  /** Open the developer panel; undefined without `?developer`. */
  readonly onLog: (() => void) | undefined;
  /** Rail items for the side panels: Examples, Jobs. */
  readonly railItems?: ReactNode;
}

const TITLE = "OGC API - Processes client";

export function AppFrame(props: AppFrameProps) {
  const { style, inert, appearance, tools } = props;
  // STYLE TRIAL: once a style is chosen, keep one branch and delete the other.
  if (style === "instrument") return <Rail {...props} />;
  return (
    <header className="app-header" inert={inert}>
      <div className="app-title">
        <h1>{TITLE}</h1>
        <p className="tagline">Discover, run and view geospatial calculations</p>
      </div>
      <div className="header-tools">
        <p className="muted version" data-testid="core-version">
          core {VERSION}
        </p>
        {tools}
        {appearance}
      </div>
    </header>
  );
}

/** A small line icon, drawn in the current text colour. */
function Icon({ d }: { readonly d: string }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const ICONS = {
  connect: "M8 12l4-4M6.5 9.5l-2 2a3 3 0 0 0 4 4l2-2M13.5 10.5l2-2a3 3 0 0 0-4-4l-2 2",
  processes: "M4 5h12M4 10h12M4 15h12",
  examples: "M10 3l2 4.5 4.5.5-3.5 3 1 4.5-4-2.5-4 2.5 1-4.5-3.5-3 4.5-.5z",
  jobs: "M10 4v6l4 2M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z",
  log: "M4 4h12v12H4zM7 8h6M7 11h6M7 14h3",
} as const;

export function RailItem({
  icon,
  label,
  current,
  pressed,
  onClick,
  badge,
  controls,
}: {
  readonly icon: keyof typeof ICONS;
  readonly label: string;
  readonly current?: boolean | undefined;
  /** For an item that opens a panel: whether it is open. */
  readonly pressed?: boolean | undefined;
  readonly onClick: (() => void) | undefined;
  readonly badge?: ReactNode;
  readonly controls?: string | undefined;
}) {
  return (
    <li>
      <button
        type="button"
        className="rail-item"
        aria-current={current === true ? "page" : undefined}
        aria-expanded={pressed}
        aria-controls={controls}
        disabled={onClick === undefined}
        onClick={onClick}
      >
        <Icon d={ICONS[icon]} />
        <span className="rail-label">{label}</span>
        {badge}
      </button>
    </li>
  );
}

// STYLE TRIAL (instrument): delete with the instrument style.
function Rail(props: AppFrameProps) {
  const { inert, appearance, place, onConnect, onProcesses, onLog, railItems } = props;
  return (
    <header className="app-rail" inert={inert}>
      <h1 className="visually-hidden">{TITLE}</h1>
      <p className="rail-logo" aria-hidden="true">
        OAP
      </p>
      <nav className="rail-nav" aria-label="Workflow">
        <ul>
          {/* "Start", not "Connect": the start screen's own button is Connect. */}
          <RailItem
            icon="connect"
            label="Start"
            current={place === "connect"}
            onClick={onConnect}
          />
          <RailItem
            icon="processes"
            label="Processes"
            current={place === "processes"}
            onClick={onProcesses}
          />
          {railItems}
          {onLog !== undefined && <RailItem icon="log" label="Log" onClick={onLog} />}
        </ul>
      </nav>
      <div className="rail-end">
        {appearance}
        <p className="rail-version" data-testid="core-version">
          core {VERSION}
        </p>
      </div>
    </header>
  );
}
