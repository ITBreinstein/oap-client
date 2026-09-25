import { VERSION } from "@breinstein/oap-client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DeveloperPanel } from "./app/DeveloperPanel.js";
import { activeDrawField, DrawContext, type DrawRequest, type DrawTarget } from "./app/draw.js";
import { EndpointScreen } from "./app/EndpointScreen.js";
import { MapPane } from "./app/MapPane.js";
import { ProcessListScreen } from "./app/ProcessListScreen.js";
import { ProcessScreen } from "./app/ProcessScreen.js";
import { RelayBanner, RelayOffer } from "./app/RelayRoute.js";
import { useWorkflow } from "./app/useWorkflow.js";

const configuredRelay = import.meta.env.VITE_RELAY_URL;
const relayUrl = configuredRelay === "" ? undefined : configuredRelay;

function developerRequested(): boolean {
  try {
    return new URLSearchParams(globalThis.location.search).has("developer");
  } catch {
    return false;
  }
}

export function App() {
  const view = useWorkflow(relayUrl);
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
          listFilter={state.listFilter}
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
        />
      );
      break;
  }

  return (
    <DrawContext.Provider value={draw}>
      <div className="app">
        <header className="app-header">
          <h1>OGC API - Processes client</h1>
          <p className="muted" data-testid="core-version">
            core {VERSION}
          </p>
        </header>
        <div className="layout">
          <main className="panel" ref={panel}>
            {state.stage !== "choose-endpoint" && state.route === "relay" && <RelayBanner />}
            {screen}
            {state.stage === "choose-endpoint" && state.offer !== undefined && (
              <RelayOffer onConfirm={commands.confirmRelay} onDecline={commands.declineRelay} />
            )}
            <DeveloperPanel
              observations={view.snapshot?.observations ?? []}
              relayUrl={relayUrl}
              open={developer}
            />
          </main>
          <MapPane
            state={state}
            draw={draw}
            setValue={commands.setValue}
            onAvailable={setMapAvailable}
          />
        </div>
      </div>
    </DrawContext.Provider>
  );
}
