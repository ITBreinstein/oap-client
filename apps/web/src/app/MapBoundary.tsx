/**
 * Keeps a map failure on the map (review W3).
 *
 * The map binding runs its own code, MapLibre's and Terra Draw's inside
 * effects, and React 19 unmounts the whole page when an error escapes one and
 * nothing catches it: a result too large to fit the map blanked the form, the
 * results and the jobs with it. This catches whatever the map pane throws and
 * puts a message where the map was. The form, runs, results and downloads
 * carry on without it.
 *
 * A class, because React offers error boundaries only as class components.
 */

import { Component, type ReactNode } from "react";

interface MapBoundaryProps {
  readonly children: ReactNode;
}

interface MapBoundaryState {
  /** The error's message, once the map has failed. */
  readonly failure: string | undefined;
}

export class MapBoundary extends Component<MapBoundaryProps, MapBoundaryState> {
  override state: MapBoundaryState = { failure: undefined };

  static getDerivedStateFromError(error: unknown): MapBoundaryState {
    return { failure: error instanceof Error ? error.message : String(error) };
  }

  override render(): ReactNode {
    if (this.state.failure === undefined) return this.props.children;
    return (
      <aside className="map-pane" aria-label="Map">
        <p className="map-failure" role="alert">
          The map stopped working ({this.state.failure}). The form, runs and results carry on
          without it, and results can still be downloaded. Reload the page to bring the map back.
        </p>
      </aside>
    );
  }
}
