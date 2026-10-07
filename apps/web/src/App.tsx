import { VERSION } from "@breinstein/oap-client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DeveloperPanel } from "./app/DeveloperPanel.js";
import { activeDrawField, DrawContext, type DrawRequest, type DrawTarget } from "./app/draw.js";
import { EndpointScreen } from "./app/EndpointScreen.js";
import { MapBoundary } from "./app/MapBoundary.js";
import { MapLimitsContext, type MapLimits } from "./app/map-limits.js";
import { MapPane } from "./app/MapPane.js";
import { ProcessListScreen } from "./app/ProcessListScreen.js";
import { ProcessScreen } from "./app/ProcessScreen.js";
import { DEV_PRESETS } from "./app/dev-presets.js";
import { JobsPanel } from "./jobs/JobsPanel.js";
import { RelayBanner, RelayOffer } from "./app/RelayRoute.js";
import { useWorkflow } from "./app/useWorkflow.js";
import {
  DEFAULT_MAX_EDITABLE_COORDINATES,
  DEFAULT_MAX_MAP_COORDINATES,
  STATIC_ONLY,
  type RuntimeConfig,
} from "./config/runtime-config.js";

function developerRequested(): boolean {
  try {
    return new URLSearchParams(globalThis.location.search).has("developer");
  } catch {
    return false;
  }
}

export interface AppProps {
  /** From `config.json`, read before the first render (`main.tsx`). */
  readonly config?: RuntimeConfig | undefined;
  /** Why the page fell back to running without the relay, if it did. */
  readonly configWarning?: string | undefined;
}

export function App({ config = STATIC_ONLY, configWarning }: AppProps) {
  const { relayUrl } = config;
  // The local reference servers, in development only: `import.meta.env.DEV` is
  // `false` in a production build, and the list is dropped from the bundle.
  const presets = useMemo(
    () => (import.meta.env.DEV ? [...DEV_PRESETS, ...config.presets] : config.presets),
    [config.presets],
  );
  const view = useWorkflow(relayUrl, config.acceptedNoticeMs);
  const mapLimits = useMemo<MapLimits>(
    () => ({
      maxCoordinates: config.maxMapCoordinates ?? DEFAULT_MAX_MAP_COORDINATES,
      maxEditableCoordinates: config.maxEditableCoordinates ?? DEFAULT_MAX_EDITABLE_COORDINATES,
    }),
    [config.maxMapCoordinates, config.maxEditableCoordinates],
  );
  const { state, commands } = view;
  const [developer] = useState(developerRequested);
  const [mapAvailable, setMapAvailable] = useState(false);

  // Drawing belongs to one field of one open process. It is recorded with the
  // process it was started for, so choosing another process — or leaving the
  // form — ends it without an effect having to notice (T9).
  const [drawFor, setDrawFor] = useState<DrawRequest | undefined>();
  const openProcessId = state.stage === "process" ? state.process.id : undefined;
  const openForm = state.stage === "process" ? state.plan : undefined;
  const drawField = activeDrawField(drawFor, openForm);

  const draw = useMemo<DrawTarget>(
    () => ({
      fieldId: drawField,
      available: mapAvailable,
      start: (fieldId) => {
        if (openForm !== undefined) setDrawFor({ form: openForm, fieldId });
      },
      stop: () => {
        setDrawFor(undefined);
      },
    }),
    [drawField, mapAvailable, openForm],
  );

  // Each stage moves focus to its heading, so a keyboard user lands where the
  // new content starts rather than on a button that no longer exists.
  const panel = useRef<HTMLDivElement>(null);
  const stageKey = `${state.stage}:${openProcessId ?? ""}`;
  useEffect(() => {
    const target = panel.current?.querySelector<HTMLElement>("[data-focus-on-stage]");
    target?.focus();
  }, [stageKey]);

  let screen: ReactNode;
  switch (state.stage) {
    case "choose-endpoint":
      screen = (
        <EndpointScreen
          configured={view.configured}
          configuredError={view.configuredError}
          presets={presets}
          connecting={state.connecting}
          error={state.error}
          onConnect={commands.connect}
        />
      );
      break;
    case "connected":
      screen = (
        <ProcessListScreen
          endpoint={state.endpoint}
          service={state.service}
          processes={state.processes}
          opening={state.opening}
          error={state.error}
          onOpen={commands.openProcess}
          onDisconnect={commands.disconnect}
        />
      );
      break;
    case "process":
    case "running":
    case "result":
      screen = (
        <ProcessScreen
          state={state}
          commands={{
            ...commands,
            // Running ends drawing: the form it was drawing for is read-only
            // from here, and coming back to edit should not resume it.
            run: () => {
              setDrawFor(undefined);
              commands.run();
            },
          }}
          fieldErrors={view.fieldErrors}
          jobs={view.snapshot?.jobs ?? []}
          jobNotice={view.jobNotice}
          dismissAdvertisedBy={view.dismissAdvertisedBy}
          developer={developer}
        />
      );
      break;
  }

  // While the relay offer is open, everything else is inert: no keyboard or
  // pointer can reach Connect or the jobs behind the question (review W22).
  const offerOpen = state.stage === "choose-endpoint" && state.offer !== undefined;

  return (
    <MapLimitsContext value={mapLimits}>
      <DrawContext.Provider value={draw}>
        <div className="app" data-relay-stream={view.snapshot?.relay}>
          <header className="app-header" inert={offerOpen}>
            <h1>OGC API - Processes client</h1>
            <p className="muted" data-testid="core-version">
              core {VERSION}
            </p>
          </header>
          {configWarning !== undefined && (
            <p
              className="notice config-warning"
              role="alert"
              data-testid="config-warning"
              inert={offerOpen}
            >
              {configWarning}
            </p>
          )}
          {relayUrl === undefined && (
            <p className="muted static-only" data-testid="static-only" inert={offerOpen}>
              This page runs without the relay: every request goes straight from your browser to the
              service. A service must allow web pages to read it (CORS), and a background run is
              found only where the service lets a page read the job&apos;s address. Callbacks, and
              reading services that send no CORS headers, need the relay.
            </p>
          )}
          <div className="layout" inert={offerOpen}>
            <main className="panel" ref={panel}>
              {state.stage !== "choose-endpoint" && state.route === "relay" && <RelayBanner />}
              {screen}
              <JobsPanel
                jobs={view.snapshot?.jobs ?? []}
                activeJob={
                  state.stage === "running" && state.run.mode === "async"
                    ? state.run.jobRef
                    : undefined
                }
                dismissAdvertisedFor={view.dismissAdvertisedFor}
                messages={view.jobMessages}
                onRemove={commands.removeJob}
                onDismiss={commands.dismissJob}
              />
              <DeveloperPanel
                observations={view.snapshot?.observations ?? []}
                dropped={view.snapshot?.droppedObservations ?? 0}
                relayUrl={relayUrl}
                open={developer}
                census={view.census}
                onDescribeAll={state.stage === "choose-endpoint" ? undefined : commands.describeAll}
              />
            </main>
            <MapBoundary>
              <MapPane
                state={state}
                draw={draw}
                setValue={commands.setValue}
                onAvailable={setMapAvailable}
              />
            </MapBoundary>
          </div>
          {offerOpen && (
            <RelayOffer onConfirm={commands.confirmRelay} onDecline={commands.declineRelay} />
          )}
        </div>
      </DrawContext.Provider>
    </MapLimitsContext>
  );
}
