import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
const container = root;

// Read once, before the first render, so nothing starts — no relay session,
// no stream — on a configuration that is about to change. Never rejects.
void loadRuntimeConfig().then(({ config, warning }) => {
  createRoot(container).render(
    <StrictMode>
      <App config={config} configWarning={warning} />
    </StrictMode>,
  );
});
