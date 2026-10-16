/**
 * The app's frame: a rail down the left edge (a bar along the bottom on a
 * narrow screen), with Breinstein's wordmark, one item per place in the
 * workflow, the side panels' items, Appearance and the core's version.
 */

import { VERSION } from "@breinstein/oap-client";
import type { MouseEvent, ReactNode } from "react";
import { Wordmark } from "./BrandMark.js";

/** Where in the workflow the page is, for the rail's current item. */
export type FramePlace = "connect" | "processes" | "process";

export interface AppFrameProps {
  /** Set while a modal question is open: nothing in the frame can be reached. */
  readonly inert: boolean;
  /** The Appearance control. */
  readonly appearance: ReactNode;
  /** Where in the workflow the page is. */
  readonly place: FramePlace;
  /** Back to the start screen; undefined where it cannot be left (a run under way). */
  readonly onConnect: (() => void) | undefined;
  /** Back to the list; undefined before connecting, or while a run is under way. */
  readonly onProcesses: (() => void) | undefined;
  /** Rail items for the side panels: Examples. */
  readonly railItems?: ReactNode;
  /** The rail's Jobs item. */
  readonly jobsItem?: ReactNode;
  /** The rail's About item, above Appearance. */
  readonly aboutItem?: ReactNode;
}

const TITLE = "OGC API - Processes client";

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
  about: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v5M12 8h.01",
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

/** The start address: the app's own base, so a new tab opens on the start screen too. */
const START_HREF = import.meta.env.BASE_URL;

/**
 * Breinstein's wordmark, a link to the start screen.
 * A plain click goes there without reloading, as the Start item does; a click
 * that asks for a new tab or window is left to the browser. When Start cannot
 * be used (a run under way) neither can this: no address, so no link to follow.
 */
export function StartLink({
  onConnect,
  className = "rail-logo",
}: {
  readonly onConnect: (() => void) | undefined;
  readonly className?: string | undefined;
}) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onConnect?.();
  };
  return (
    <a
      className={className}
      href={onConnect === undefined ? undefined : START_HREF}
      aria-label="Breinstein · OGC API Processes client, start"
      aria-disabled={onConnect === undefined ? true : undefined}
      onClick={go}
    >
      <Wordmark className="wordmark" />
    </a>
  );
}

export function AppFrame(props: AppFrameProps) {
  const { inert, appearance, place, onConnect, onProcesses, railItems, jobsItem, aboutItem } =
    props;
  return (
    <header className="app-rail" inert={inert}>
      <h1 className="visually-hidden">{TITLE}</h1>
      <StartLink onConnect={onConnect} />
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
        </ul>
      </nav>
      <div className="rail-end">
        {aboutItem !== undefined && <ul className="rail-end-items">{aboutItem}</ul>}
        {appearance}
        <p className="rail-version" data-testid="core-version">
          core {VERSION}
        </p>
      </div>
    </header>
  );
}
