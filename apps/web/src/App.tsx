import { redactUrl } from "@breinstein/oap-client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Appearance } from "./app/appearance.js";
import { AppearanceControl } from "./app/AppearanceControl.js";
import { UpdatedContext } from "./app/variant.js";
import { DeveloperContext } from "./app/developer.js";
import { sameService, useAddress, wouldLoseWork } from "./app/address.js";
import { AppFrame, RailItem, type FramePlace } from "./app/AppFrame.js";
import { DeveloperPanel } from "./app/DeveloperPanel.js";
import { activeDrawField, DrawContext, type DrawRequest, type DrawTarget } from "./app/draw.js";
import { EndpointScreen } from "./app/EndpointScreen.js";
import { MapBoundary } from "./app/MapBoundary.js";
import { MapLimitsContext, type MapLimits } from "./app/map-limits.js";
import { mapNeeded } from "./app/map-need.js";
import { MapPane } from "./app/MapPane.js";
import { createWorldMap } from "./map/MapView.js";
import { needsOfPlan, type Needs } from "./app/needs.js";
import { ProcessListScreen } from "./app/ProcessListScreen.js";
import { ProcessScreen, RequestLog } from "./app/ProcessScreen.js";
import { AboutFooter, AboutPanel } from "./app/AboutPanel.js";
import { DEV_EXAMPLES, DEV_PRESETS } from "./app/dev-presets.js";
import { exampleNeeds } from "./app/examples.js";
import { ExamplesBrowser, FeaturedExamples } from "./app/ExamplesView.js";
import { typedEndpoint } from "./app/run.js";
import { SidePanel } from "./app/SidePanel.js";
import { learnTitles, NO_TITLES, processTitle, serviceTitle, type Titles } from "./app/titles.js";
import type { EndpointRef } from "./app/workflow.js";
import type { FormValues } from "./forms/encode.js";
import type { JobRow } from "./relay/job-session.js";
import { JobsPanel } from "./jobs/JobsPanel.js";
import { isUnderWay } from "./jobs/under-way.js";
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
  const { appearance, resolvedTheme, setStyle, setTheme } = useAppearance(initial);
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
  const address = useAddress(state, commands);
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

  // The names this visit has read, for My jobs (#43): learned while
  // rendering, as `described` is, from the service and process on screen.
  const [titles, setTitles] = useState<Titles>(NO_TITLES);
  const learned =
    state.stage === "choose-endpoint"
      ? titles
      : learnTitles(titles, state.endpoint.baseUrl, state.service.title, [
          ...state.processes.processes,
          ...(state.stage === "connected" ? [] : [state.process]),
        ]);
  if (learned !== titles) setTitles(learned);
  // STYLE TRIAL (updated Instrument, #43): My jobs names a job's process and service.
  const jobNames = (job: JobRow) => ({
    process:
      job.processId === undefined
        ? (job.status?.jobId ?? job.statusUrl)
        : processTitle(titles, examples, job.endpoint, job.processId),
    service: serviceTitle(titles, presets, job.endpoint),
  });

  const [panelOpen, setPanelOpen] = useState<Panel | undefined>();
  const togglePanel = (which: Panel) => {
    setPanelOpen((current) => (current === which ? undefined : which));
  };
  const closePanel = useCallback(() => {
    setPanelOpen(undefined);
  }, []);
  // STYLE TRIAL: in the updated Instrument a background job with a link can
  // be left, from the rail too: it goes on in My jobs.
  const leaveJob =
    appearance.style === "instrument-updated" && state.stage === "running" && !wouldLoseWork(state);
  const busy =
    (state.stage === "running" && !leaveJob) ||
    (state.stage === "choose-endpoint" && state.connecting !== undefined);
  const jobs = view.snapshot?.jobs ?? [];
  // Under way only: a finished job needs nothing from anyone, even while the
  // page confirms it (#30).
  const runningJobs = jobs.filter(isUnderWay).length;
  const jobsBadge =
    runningJobs === 0 ? undefined : (
      <span className="badge">
        <span className="visually-hidden">, </span>
        {String(runningJobs)}
        <span className="visually-hidden"> running</span>
      </span>
    );
  // STYLE TRIAL (updated Instrument): "Run again" in My jobs. The inputs of
  // each background job started this visit, by its status URL: in memory
  // only, never stored, so a job from an earlier visit opens an empty form.
  const sentFor = useRef(new Map<string, FormValues>());
  useEffect(() => {
    // A job this page only followed: its inputs are not the form's.
    if (
      state.stage === "running" &&
      state.run.mode === "async" &&
      state.run.jobRef !== undefined &&
      state.run.watched !== true
    ) {
      sentFor.current.set(state.run.jobRef, state.values);
    } else if (state.stage === "result" && state.jobRef !== undefined && state.watched !== true) {
      sentFor.current.set(state.jobRef, state.values);
    }
  }, [state]);
  const pendingRerun = useRef<{
    processId: string;
    values?: FormValues | undefined;
    /** Tick Run in the background once it is open (#25). */
    background?: true | undefined;
  }>(undefined);
  useEffect(() => {
    const pending = pendingRerun.current;
    if (
      pending === undefined ||
      state.stage !== "process" ||
      state.process.id !== pending.processId
    ) {
      return;
    }
    pendingRerun.current = undefined;
    if (pending.values === undefined && pending.background !== true) return;
    for (const [id, value] of Object.entries(pending.values ?? {})) commands.setValue(id, value);
    commands.setMode("async");
  }, [state, commands]);
  /** The service a listed job ran on, reached the way this page reaches it. */
  const endpointOfJob = (job: JobRow): EndpointRef | undefined => {
    const here = state.stage === "choose-endpoint" ? undefined : state.endpoint;
    const listed = view.configured.find((entry) => entry.key === job.endpointKey);
    return here !== undefined && sameService(here.baseUrl, job.endpoint)
      ? here
      : listed !== undefined
        ? { source: "configured", ...listed }
        : typedEndpoint(job.endpoint);
  };
  const rerun = (job: JobRow) => {
    const endpoint = endpointOfJob(job);
    if (job.processId === undefined || endpoint === undefined) return;
    pendingRerun.current = { processId: job.processId, values: sentFor.current.get(job.statusUrl) };
    setPanelOpen(undefined);
    commands.openExample(endpoint, job.processId);
  };
  // STYLE TRIAL (updated Instrument): a job in My jobs shown here, as its link shows it.
  const followJob = (job: JobRow) => {
    const endpoint = endpointOfJob(job);
    if (job.processId === undefined || endpoint === undefined) return;
    setPanelOpen(undefined);
    address.followJob(endpoint, job.processId, job.statusUrl);
  };

  // #25: a direct service that hides where its background jobs are, which
  // the relay also lists with its background runs through it. One click
  // reconnects that way, to the same process: the form comes back as it is
  // (it is kept by service), with Run in the background ticked.
  const backgroundUnfindable =
    state.stage !== "choose-endpoint" && view.backgroundUnfindable(state.endpoint);
  const relayForBackground =
    state.stage === "choose-endpoint" || !view.backgroundUnfindable(state.endpoint)
      ? undefined
      : view.configured.find(
          (entry) =>
            entry.executeRoute === "relay" &&
            sameService(entry.baseUrl, state.endpoint.baseUrl) &&
            !view.backgroundUnfindable({ source: "configured", ...entry }),
        );
  const switchToRelay =
    relayForBackground === undefined || state.stage !== "process"
      ? undefined
      : () => {
          pendingRerun.current = { processId: state.process.id, background: true };
          commands.openExample({ source: "configured", ...relayForBackground }, state.process.id);
        };

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
  // The user's own way somewhere else closes any side panel (#35). From
  // inside a panel, its actions close it themselves (an example, Run again,
  // a job followed); from outside, with the page inert behind it, the only
  // way is the browser's Back or Forward. Not the page's own moves: a
  // followed job finishing, or a reload going back to where it was.
  useEffect(() => {
    const onPop = () => {
      setPanelOpen(undefined);
    };
    globalThis.addEventListener("popstate", onPop);
    return () => {
      globalThis.removeEventListener("popstate", onPop);
    };
  }, []);

  let screen: ReactNode;
  switch (state.stage) {
    case "choose-endpoint":
      screen = (
        <EndpointScreen
          // A new link to answer starts the screen afresh, its address filled in.
          key={address.linked?.service ?? ""}
          configured={view.configured}
          configuredError={view.configuredError}
          presets={presets}
          connecting={state.connecting}
          error={state.error}
          failed={state.failed}
          titleOf={(baseUrl) => titles.services.get(baseUrl.replace(/\/+$/, ""))}
          staticOnly={relayUrl === undefined}
          onConnect={address.connect}
          linked={address.linked}
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
            // STYLE TRIAL: in the updated Instrument, "Change the inputs"
            // brings the drawing back, its tools and its shape to edit: the
            // drawing is kept, and is the open form's again once it is back.
            run: () => {
              if (appearance.style !== "instrument-updated") setDrawFor(undefined);
              commands.run();
            },
          }}
          fieldErrors={view.fieldErrors}
          jobs={view.snapshot?.jobs ?? []}
          jobNotice={view.jobNotice}
          dismissAdvertisedBy={view.dismissAdvertisedBy}
          developer={developer}
          observations={view.snapshot?.observations}
          backgroundUnfindable={backgroundUnfindable}
          onRelayForBackground={switchToRelay}
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
  // While a side panel is open, so is everything but it (#35): it is a dialog.
  const behindPanel = panelOpen !== undefined;
  const behind = offerOpen || behindPanel;

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
  // What the visitor's words leave out, for the Developer section (#25, #43).
  const shownJobRef =
    state.stage === "running" && state.run.mode === "async"
      ? state.run.jobRef
      : state.stage === "result"
        ? state.jobRef
        : undefined;
  const shownJobId =
    shownJobRef === undefined
      ? undefined
      : jobs.find((job) => job.statusUrl === shownJobRef)?.status?.jobId;
  const developerNotes = [
    ...(state.stage === "process" && state.error?.technical !== undefined
      ? [state.error.technical]
      : []),
    ...(shownJobId === undefined ? [] : [`Job ${shownJobId}`]),
    ...(state.stage === "result" &&
    jobs.find((job) => job.statusUrl === shownJobRef)?.confirmation?.state === "pending"
      ? ["Not yet confirmed: the page reads the job's status again, quietly, for a while."]
      : []),
  ];
  const onConnect =
    state.stage === "choose-endpoint"
      ? focusStage
      : state.stage === "running" && !leaveJob
        ? undefined
        : commands.disconnect;
  const onProcesses =
    state.stage === "connected"
      ? focusStage
      : state.stage === "process" || state.stage === "result" || leaveJob
        ? commands.backToList
        : undefined;
  return (
    <MapLimitsContext value={mapLimits}>
      <UpdatedContext value={appearance.style === "instrument-updated"}>
        <DeveloperContext value={developer}>
          <DrawContext.Provider value={draw}>
            <div
              className="app"
              data-relay-stream={view.snapshot?.relay}
              data-developer={developer ? true : undefined}
            >
              {/* The first stop for a keyboard: past the rail, to the page itself. */}
              <a className="skip-link" href="#content" inert={behindPanel}>
                Skip to content
              </a>
              <AppFrame
                inert={behind}
                appearance={
                  <AppearanceControl
                    appearance={appearance}
                    onStyle={setStyle}
                    onTheme={setTheme}
                  />
                }
                place={place}
                onConnect={onConnect}
                onProcesses={onProcesses}
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
                    inert={behind}
                  >
                    {configWarning}
                  </p>
                )}
                <div className={showMap ? "layout" : "layout layout-single"} inert={behind}>
                  <main
                    id="content"
                    tabIndex={-1}
                    className="panel"
                    ref={panel}
                    data-stage={state.stage}
                  >
                    {state.stage !== "choose-endpoint" && state.route === "relay" && (
                      <RelayBanner />
                    )}
                    {screen}
                    {/* The credit for the picture behind the page without a map (backdrop.css). */}
                    {!showMap && (
                      <p className="backdrop-credit">
                        Imagery: NASA Blue Marble and Blue Marble clouds · NASA Earth at Night 2012
                      </p>
                    )}
                    <DeveloperPanel
                      observations={view.snapshot?.observations ?? []}
                      dropped={view.snapshot?.droppedObservations ?? 0}
                      relayUrl={relayUrl}
                      open={developer}
                      census={view.census}
                      notes={developerNotes}
                      onDescribeAll={
                        state.stage === "choose-endpoint" ? undefined : commands.describeAll
                      }
                      first={
                        // STYLE TRIAL: the updated Instrument keeps the request log here.
                        appearance.style === "instrument-updated" &&
                        state.stage !== "choose-endpoint" ? (
                          <RequestLog
                            entries={view.snapshot?.observations ?? []}
                            endpoint={redactUrl(state.endpoint.baseUrl)}
                          />
                        ) : undefined
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
                        basemap={
                          // STYLE TRIAL: the updated Instrument's map is the world, in the theme's colours.
                          appearance.style === "instrument-updated"
                            ? {
                                create: createWorldMap[resolvedTheme],
                                label: "Map of the world (OpenFreeMap)",
                              }
                            : undefined
                        }
                      />
                    </MapBoundary>
                  )}
                </div>
                {/* What an open panel covers: a press on it closes the panel (#35).
                  The panel's keyboard way out is Escape, or its Close button. */}
                {behindPanel && (
                  <div className="panel-scrim" aria-hidden="true" onClick={closePanel} />
                )}
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
                        A process you run in the background is listed here, with its status, until
                        you remove it from the list. It stays listed when you reload the page.
                      </p>
                      <p className="help">
                        Some services do not let a web page find a job it started, so the job runs
                        but cannot be listed. The relay can find it: choose a service the relay
                        offers.
                      </p>
                    </div>
                  )}
                  <JobsPanel
                    heading={false}
                    structured={appearance.style === "instrument-updated"}
                    names={appearance.style === "instrument-updated" ? jobNames : undefined}
                    cancelled={view.cancelled}
                    rerun={
                      appearance.style === "instrument-updated"
                        ? {
                            start: rerun,
                            filled: (job) => sentFor.current.has(job.statusUrl),
                            follow: followJob,
                            // A run that can't be left: a background job with a link can.
                            busy: wouldLoseWork(state) && state.stage === "running",
                          }
                        : undefined
                    }
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
                <SidePanel
                  id={PANEL_IDS.about}
                  title="About"
                  open={panelOpen === "about"}
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
        </DeveloperContext>
      </UpdatedContext>
    </MapLimitsContext>
  );
}
