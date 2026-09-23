import { VERSION } from "@breinstein/oap-client";
import { AsyncJobPanel } from "./jobs/AsyncJobPanel.js";

const relayUrl = import.meta.env.VITE_RELAY_URL;

export function App() {
  return (
    <main>
      <h1>Breinstein OGC API - Processes client</h1>
      <p data-testid="core-version">core {VERSION}</p>
      <AsyncJobPanel relayUrl={relayUrl === "" ? undefined : relayUrl} />
    </main>
  );
}
