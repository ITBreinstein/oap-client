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
 * nothing a test or a screen reader relies on depends on the style. The
 * header also has the way back and the page's place, which only precise shows
 * (in place of the panel's breadcrumb, which it hides).
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
  /** Rail items for the side panels: Examples. */
  readonly railItems?: ReactNode;
  /** The rail's Jobs item. */
  readonly jobsItem?: ReactNode;
  /**
   * STYLE TRIAL (precise): the way back and where the page is, for the ruled
   * header. Shown by precise only, which hides the panel's own breadcrumb.
   */
  readonly back?: FrameBack | undefined;
  readonly context?: string | undefined;
}

/** The header's way back: its words, and what it does (undefined: not now). */
export interface FrameBack {
  readonly label: string;
  readonly onClick: (() => void) | undefined;
}

const TITLE = "OGC API - Processes client";

export function AppFrame(props: AppFrameProps) {
  const { style, inert, appearance, tools, back, context } = props;
  // STYLE TRIAL: once a style is chosen, keep one branch and delete the other.
  if (style === "instrument") return <Rail {...props} />;
  return (
    <header className="app-header" inert={inert} data-back={back !== undefined}>
      {back !== undefined && (
        <button
          type="button"
          className="link frame-back"
          disabled={back.onClick === undefined}
          onClick={back.onClick}
        >
          <span aria-hidden="true">← </span>
          {back.label}
        </button>
      )}
      <div className="app-title">
        <h1>{TITLE}</h1>
        <p className="tagline">Discover, run and view geospatial calculations</p>
      </div>
      {context !== undefined && <p className="frame-context label">{context}</p>}
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

/** A small line icon, drawn in the current text colour, on the design's 24-unit grid. */
function Icon({ d }: { readonly d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const ICONS = {
  connect:
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  processes: "M4 6h16M4 12h16M4 18h10",
  examples: "M12 3.5l2.5 5.3 5.8.7-4.3 3.9 1.2 5.7-5.2-2.9-5.2 2.9 1.2-5.7-4.3-3.9 5.8-.7z",
  jobs: "M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16zM12 8v4l3 2",
  log: "M5 5h14v14H5zM8 9h8M8 13h8M8 17h5",
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
  const { inert, appearance, place, onConnect, onProcesses, onLog, railItems, jobsItem } = props;
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
          {/* A process is a place within the processes, as the design marks it. */}
          <RailItem
            icon="processes"
            label="Processes"
            current={place !== "connect"}
            onClick={onProcesses}
          />
          {railItems}
          {jobsItem}
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
