/**
 * The app's frame: the one place that asks which style is on (ADR 0002).
 * Everything else differs between styles in CSS only.
 *
 * The soft-precise hybrid and precise styles put the title and the page's
 * tools in a header across the top.
 */

import { VERSION } from "@breinstein/oap-client";
import type { ReactNode } from "react";
import type { StyleName } from "./appearance.js";

export interface AppFrameProps {
  readonly style: StyleName;
  /** Set while a modal question is open: nothing in the frame can be reached. */
  readonly inert: boolean;
  /** The header's tools, at its end: My jobs, Appearance. */
  readonly tools: ReactNode;
}

export function AppFrame({ inert, tools }: AppFrameProps) {
  return (
    <header className="app-header" inert={inert}>
      <div className="app-title">
        <h1>OGC API - Processes client</h1>
        <p className="tagline">Discover, run and view geospatial calculations</p>
      </div>
      <div className="header-tools">
        <p className="muted version" data-testid="core-version">
          core {VERSION}
        </p>
        {tools}
      </div>
    </header>
  );
}
