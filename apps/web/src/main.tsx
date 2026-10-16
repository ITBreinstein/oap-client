import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import {
  applyAppearance,
  resolveTheme,
  startingAppearance,
  systemPrefersDark,
} from "./app/appearance.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";
// Tokens first: every other sheet reads them. Then structure, then each style.
import "./styles/fonts.js";
import "./styles/tokens.css";
import "./styles.css";
import "./styles/style-hybrid.css";
import "./styles/style-precise.css";
import "./styles/style-instrument.css";
import "./styles/backdrop.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
const container = root;

// The style and theme go onto <html> before anything is drawn, so the page
// never shows in the wrong colours first. An inline script in index.html would
// do it sooner, but the site's content security policy allows none.
const appearance = startingAppearance();
applyAppearance(
  document.documentElement,
  appearance,
  resolveTheme(appearance.theme, systemPrefersDark()),
);

// Read once, before the first render, so nothing starts — no relay session,
// no stream — on a configuration that is about to change. Never rejects.
void loadRuntimeConfig().then(({ config, warning }) => {
  createRoot(container).render(
    <StrictMode>
      <App config={config} configWarning={warning} appearance={appearance} />
    </StrictMode>,
  );
});
