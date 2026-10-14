import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Appearance } from "./app/appearance.js";
import { AppearanceControl } from "./app/AppearanceControl.js";
import { AppFrame } from "./app/AppFrame.js";
import { DeveloperPanel } from "./app/DeveloperPanel.js";
import { activeDrawField, DrawContext, type DrawRequest, type DrawTarget } from "./app/draw.js";
import { EndpointScreen } from "./app/EndpointScreen.js";
import { MapBoundary } from "./app/MapBoundary.js";
import { MapLimitsContext, type MapLimits } from "./app/map-limits.js";
import { mapNeeded } from "./app/map-need.js";
import { MapPane } from "./app/MapPane.js";
import { needsOfPlan, type Needs } from "./app/needs.js";
import { ProcessListScreen } from "./app/ProcessListScreen.js";
import { ProcessScreen } from "./app/ProcessScreen.js";
import { DEV_PRESETS } from "./app/dev-presets.js";
import { JobsPanel } from "./jobs/JobsPanel.js";
import { RelayBanner, RelayOffer } from "./app/RelayRoute.js";
import { useAppearance } from "./app/useAppearance.js";
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
  /** The style and theme `main.tsx` put on `<html>`; read afresh when absent. */
  readonly appearance?: Appearance | undefined;
}

export function App({ config = STATIC_ONLY, configWarning, appearance: initial }: AppProps) {
  const { relayUrl } = config;
  const { appearance, setStyle, setTheme } = useAppearance(initial);
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

  // What each process opened this visit needs, by endpoint and id: the
  // process list shows it once known, and never fetches a description for it.
  const [described, setDescribed] = useState<ReadonlyMap<string, Needs>>(() => new Map());
  const openedPlan =
    state.stage === "choose-endpoint" || state.stage === "connected" ? undefined : state.plan;
  const openedKey =
    state.stage === "choose-endpoint" || state.stage === "connected"
      ? undefined
      : `${state.endpoint.baseUrl}\n${state.process.id}`;
  // Recorded while rendering, the way React documents for state that follows
  // other state: no effect, and no render with the old value on screen.
  if (openedKey !== undefined && openedPlan !== undefined && !described.has(openedKey)) {
    setDescribed(new Map(described).set(openedKey, needsOfPlan(openedPlan)));
  }
  const listNeeds = useMemo(() => {
    if (state.stage !== "connected") return undefined;
    const prefix = `${state.endpoint.baseUrl}\n`;
    return new Map(
      [...described]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, needs]) => [key.slice(prefix.length), needs]),
    );
  }, [described, state]);

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
  // Not on the first render, though: on arrival the page starts at its top, as
  // any page does, rather than with a focus ring around the first heading.
  const panel = useRef<HTMLDivElement>(null);
  const stageKey = `${state.stage}:${openProcessId ?? ""}`;
  const shownStage = useRef(stageKey);
  useEffect(() => {
    // Compared, not counted, so React's development double run changes nothing.
    if (shownStage.current === stageKey) return;
    shownStage.current = stageKey;
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
          staticOnly={relayUrl === undefined}
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
          route={state.route}
          needs={listNeeds}
          lastOpened={state.lastOpened}
          ran={state.ran ?? []}
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
          observations={view.snapshot?.observations}
        />
      );
      break;
  }

  // The map is on screen only while it has a job to do: an input it can draw,
  // or a result it can show (`app/map-need.ts`). Otherwise the panel has the
  // page to itself, and no basemap tile is fetched.
  const showMap = mapNeeded(state, mapLimits.maxCoordinates);

  // While the relay offer is open, everything else is inert: no keyboard or
  // pointer can reach Connect or the jobs behind the question (review W22).
  const offerOpen = state.stage === "choose-endpoint" && state.offer !== undefined;

  return (
    <MapLimitsContext value={mapLimits}>
      <DrawContext.Provider value={draw}>
        <div className="app" data-relay-stream={view.snapshot?.relay}>
          <AppFrame
            style={appearance.style}
            inert={offerOpen}
            tools={
              <AppearanceControl appearance={appearance} onStyle={setStyle} onTheme={setTheme} />
            }
          />
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
          <div className={showMap ? "layout" : "layout layout-single"} inert={offerOpen}>
            <main className="panel" ref={panel} data-stage={state.stage}>
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
            {showMap && (
              <MapBoundary>
                <MapPane
                  state={state}
                  draw={draw}
                  setValue={commands.setValue}
                  onAvailable={setMapAvailable}
                />
              </MapBoundary>
            )}
          </div>
          {offerOpen && (
            <RelayOffer onConfirm={commands.confirmRelay} onDecline={commands.declineRelay} />
          )}
        </div>
      </DrawContext.Provider>
    </MapLimitsContext>
  );
}
