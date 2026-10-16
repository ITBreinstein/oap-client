import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Appearance } from "./app/appearance.js";
import { AppearanceControl } from "./app/AppearanceControl.js";
import { AppFrame, RailItem, type FrameCrumb, type FramePlace } from "./app/AppFrame.js";
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
import { AboutFooter, AboutPanel } from "./app/AboutPanel.js";
import { DEV_EXAMPLES, DEV_PRESETS } from "./app/dev-presets.js";
import { exampleNeeds } from "./app/examples.js";
import { ExamplesBrowser, FeaturedExamples } from "./app/ExamplesView.js";
import { typedEndpoint } from "./app/run.js";
import { SidePanel } from "./app/SidePanel.js";
import type { EndpointRef } from "./app/workflow.js";
import { JobsPanel } from "./jobs/JobsPanel.js";
import { RelayBanner, RelayOffer } from "./app/RelayRoute.js";
import { useAppearance } from "./app/useAppearance.js";
import { useWorkflow } from "./app/useWorkflow.js";
import {
  DEFAULT_MAX_EDITABLE_COORDINATES,
  DEFAULT_MAX_MAP_COORDINATES,
  STATIC_ONLY,
  type Example,
  type RuntimeConfig,
} from "./config/runtime-config.js";
import type { RelayEndpoint } from "./relay/contract.js";

/** The side panels; one is open at a time. */
type Panel = "examples" | "jobs" | "about";
const PANEL_IDS: Readonly<Record<Panel, string>> = {
  examples: "examples-panel",
  jobs: "jobs-panel",
  about: "about-panel",
};

/**
 * Where an example is reached: as the relay's endpoint of the same address
 * when the relay lists one, so its background runs go where that endpoint
 * says; otherwise directly, exactly as a typed address.
 */
function exampleEndpoint(
  example: Example,
  configured: readonly RelayEndpoint[],
): EndpointRef | undefined {
  const entry = configured.find((candidate) => candidate.baseUrl === example.service);
  return entry === undefined ? typedEndpoint(example.service) : { source: "configured", ...entry };
}

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
  // Development adds examples on the local reference server, as it adds presets.
  const examples = useMemo(
    () =>
      import.meta.env.DEV ? [...DEV_EXAMPLES, ...(config.examples ?? [])] : (config.examples ?? []),
    [config.examples],
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
  // What the list can say a process needs: what the examples say, and over
  // that, what the page made of a description it read.
  const listNeeds = useMemo(() => {
    if (state.stage !== "connected") return undefined;
    const prefix = `${state.endpoint.baseUrl}\n`;
    return new Map([
      ...exampleNeeds(examples, state.endpoint.baseUrl),
      ...[...described]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, needs]): [string, Needs] => [key.slice(prefix.length), needs]),
    ]);
  }, [described, examples, state]);

  const [panelOpen, setPanelOpen] = useState<Panel | undefined>();
  const togglePanel = (which: Panel) => {
    setPanelOpen((current) => (current === which ? undefined : which));
  };
  const closePanel = () => {
    setPanelOpen(undefined);
  };
  const busy =
    state.stage === "running" ||
    (state.stage === "choose-endpoint" && state.connecting !== undefined);
  const jobs = view.snapshot?.jobs ?? [];
  // Running only: a finished job needs nothing from anyone.
  const runningJobs = jobs.filter((job) => !job.settled && !job.gone).length;
  const jobsBadge =
    runningJobs === 0 ? undefined : (
      <span className="badge">
        <span className="visually-hidden">, </span>
        {String(runningJobs)}
        <span className="visually-hidden"> running</span>
      </span>
    );
  const openExample = (example: Example) => {
    const endpoint = exampleEndpoint(example, view.configured);
    if (endpoint === undefined) return;
    setPanelOpen(undefined);
    commands.openExample(endpoint, example.process);
  };

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
          examples={
            <FeaturedExamples
              examples={examples}
              busy={busy}
              onOpen={openExample}
              onBrowse={() => {
                togglePanel("examples");
              }}
              browsing={panelOpen === "examples"}
              panelId={PANEL_IDS.examples}
            />
          }
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

  // Where the page is, and the ways back, for the frame's navigation. Never
  // mid-run: leaving would abandon a job the user has not been told the fate of.
  const place: FramePlace =
    state.stage === "choose-endpoint"
      ? "connect"
      : state.stage === "connected"
        ? "processes"
        : "process";
  const focusStage = () => {
    panel.current?.querySelector<HTMLElement>("[data-focus-on-stage]")?.focus();
  };
  const onConnect =
    state.stage === "choose-endpoint"
      ? focusStage
      : state.stage === "running"
        ? undefined
        : commands.disconnect;
  const onProcesses =
    state.stage === "connected"
      ? focusStage
      : state.stage === "process" || state.stage === "result"
        ? commands.backToList
        : undefined;
  // STYLE TRIAL (precise): the header's way back and the page's place in it.
  const back =
    state.stage === "connected"
      ? { label: "Change service", onClick: commands.disconnect }
      : state.stage === "choose-endpoint"
        ? undefined
        : { label: "All processes", onClick: onProcesses };
  const context =
    state.stage === "choose-endpoint"
      ? undefined
      : state.stage === "connected"
        ? "OGC API - Processes"
        : (state.service.title ?? state.endpoint.baseUrl);
  // STYLE TRIAL (hybrid): where the page is, as a breadcrumb: the service, then the process.
  const crumbs: readonly FrameCrumb[] | undefined =
    state.stage === "choose-endpoint"
      ? undefined
      : state.stage === "connected"
        ? [{ label: state.service.title ?? state.endpoint.baseUrl, onClick: undefined }]
        : [
            { label: state.service.title ?? state.endpoint.baseUrl, onClick: onProcesses },
            { label: state.process.title ?? state.process.id, onClick: undefined },
          ];

  return (
    <MapLimitsContext value={mapLimits}>
      <DrawContext.Provider value={draw}>
        <div className="app" data-relay-stream={view.snapshot?.relay}>
          <AppFrame
            style={appearance.style}
            inert={offerOpen}
            appearance={
              <AppearanceControl appearance={appearance} onStyle={setStyle} onTheme={setTheme} />
            }
            place={place}
            back={back}
            context={context}
            crumbs={crumbs}
            onConnect={onConnect}
            onProcesses={onProcesses}
            tools={
              <button
                type="button"
                className="secondary jobs-button"
                aria-expanded={panelOpen === "jobs"}
                aria-controls={PANEL_IDS.jobs}
                onClick={() => {
                  togglePanel("jobs");
                }}
              >
                My jobs{jobsBadge}
              </button>
            }
            railItems={
              examples.length > 0 && (
                <RailItem
                  icon="examples"
                  label="Examples"
                  pressed={panelOpen === "examples"}
                  controls={PANEL_IDS.examples}
                  onClick={() => {
                    togglePanel("examples");
                  }}
                />
              )
            }
            aboutItem={
              <RailItem
                icon="about"
                label="About"
                pressed={panelOpen === "about"}
                controls={PANEL_IDS.about}
                onClick={() => {
                  togglePanel("about");
                }}
              />
            }
            jobsItem={
              <RailItem
                icon="jobs"
                label="Jobs"
                pressed={panelOpen === "jobs"}
                controls={PANEL_IDS.jobs}
                badge={jobsBadge}
                onClick={() => {
                  togglePanel("jobs");
                }}
              />
            }
          />
          <div className="app-body">
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
                <DeveloperPanel
                  observations={view.snapshot?.observations ?? []}
                  dropped={view.snapshot?.droppedObservations ?? 0}
                  relayUrl={relayUrl}
                  open={developer}
                  census={view.census}
                  onDescribeAll={
                    state.stage === "choose-endpoint" ? undefined : commands.describeAll
                  }
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
            {examples.length > 0 && (
              <SidePanel
                id={PANEL_IDS.examples}
                title="Examples"
                open={panelOpen === "examples"}
                inert={offerOpen}
                onClose={closePanel}
                className="examples-panel"
              >
                <ExamplesBrowser examples={examples} busy={busy} onOpen={openExample} />
              </SidePanel>
            )}
            <SidePanel
              id={PANEL_IDS.jobs}
              title="My jobs"
              open={panelOpen === "jobs"}
              inert={offerOpen}
              onClose={closePanel}
              className="my-jobs-panel"
            >
              {jobs.length === 0 && (
                <div className="jobs-empty">
                  <p>No background jobs yet.</p>
                  <p className="help">
                    A process you run in the background is listed here, with its status, until you
                    remove it from the list. It stays listed when you reload the page.
                  </p>
                  <p className="help">
                    Some services do not let a web page find a job it started, so the job runs but
                    cannot be listed. The relay can find it: choose a service the relay offers.
                  </p>
                </div>
              )}
              <JobsPanel
                heading={false}
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
            </SidePanel>
            {/* STYLE TRIAL (instrument): only the rail has an About item; the
                panel stays shut in the other styles, even across a style switch. */}
            <SidePanel
              id={PANEL_IDS.about}
              title="About"
              open={panelOpen === "about" && appearance.style === "instrument"}
              inert={offerOpen}
              onClose={closePanel}
              className="about-panel"
              footer={<AboutFooter />}
            >
              <AboutPanel />
            </SidePanel>
          </div>
          {offerOpen && (
            <RelayOffer onConfirm={commands.confirmRelay} onDecline={commands.declineRelay} />
          )}
        </div>
      </DrawContext.Provider>
    </MapLimitsContext>
  );
}
