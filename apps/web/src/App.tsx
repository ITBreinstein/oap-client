import { VERSION } from "@breinstein/oap-client";

export function App() {
  return (
    <main>
      <h1>Breinstein OGC API - Processes client</h1>
      <p data-testid="core-version">core {VERSION}</p>
    </main>
  );
}
